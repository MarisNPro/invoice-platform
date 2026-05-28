import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceService } from '../invoice/invoice.service';
import { CreateInvoiceBodyDto, CreateInvoiceLineBodyDto } from '../invoice/dto/create-invoice.dto';
import type { ConfirmDto, ConfirmLineDto } from './dto/confirm.dto';

const NEEDS_REVIEW_THRESHOLD = {
  overall:  0.85,
  customer: 0.70,
  amounts:  0.80,
  dates:    0.75,
  vatRate:  0.75,
};

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma:   PrismaService,
    private readonly config:   ConfigService,
    private readonly ai:       AiService,
    private readonly invoices: InvoiceService,
  ) {
    this.s3 = new S3Client({
      endpoint:        config.get('S3_ENDPOINT',  'http://localhost:9000'),
      region:          config.get('S3_REGION',    'us-east-1'),
      credentials: {
        accessKeyId:     config.get('S3_ACCESS_KEY', 'minioadmin'),
        secretAccessKey: config.get('S3_SECRET_KEY', 'minioadmin'),
      },
      forcePathStyle:  config.get('S3_FORCE_PATH_STYLE', 'true') === 'true',
    });
    this.bucket = config.get('S3_BUCKET', 'invoice-platform');
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  async upload(
    tenantId: string,
    buffer:   Buffer,
    fileName: string,
    mimeType: string,
  ) {
    if (!buffer.length) throw new BadRequestException('Empty file');

    await this.ensureBucket();

    // Use a deterministic ID so the DB row and S3 key stay in sync
    const fileId = crypto.randomUUID();
    const s3Key  = `imports/${tenantId}/${fileId}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket:      this.bucket,
        Key:         s3Key,
        Body:        buffer,
        ContentType: mimeType,
        Metadata:    { fileName, tenantId },
      }),
    );

    await this.prisma.importArchive.create({
      data: {
        id:       fileId,
        tenantId,
        fileName,
        s3Key,
        status:   'PENDING',
      },
    });

    this.logger.log(`Uploaded import ${fileId} (${buffer.length} bytes) for tenant ${tenantId}`);

    return { fileId, fileName, mimeType, sizeBytes: buffer.length };
  }

  // ── Extract ────────────────────────────────────────────────────────────────

  async extract(tenantId: string, fileId: string) {
    const archive = await this.prisma.importArchive.findUnique({ where: { id: fileId } });
    if (!archive || archive.tenantId !== tenantId) {
      throw new NotFoundException(`Import file ${fileId} not found`);
    }

    await this.prisma.importArchive.update({
      where: { id: fileId },
      data:  { status: 'PROCESSING' },
    });

    // Fetch PDF bytes from MinIO
    const { Body } = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: archive.s3Key }),
    );

    const chunks: Uint8Array[] = [];
    for await (const chunk of Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const pdfBuffer = Buffer.concat(chunks);

    // Extract with Claude
    const { parsed, missingRequiredFields, notes, usage } =
      await this.ai.extractFromPdf(pdfBuffer, tenantId);

    // Compute needsReview flag
    const c = parsed.confidence;
    const needsReview =
      c.overall  < NEEDS_REVIEW_THRESHOLD.overall  ||
      c.customer < NEEDS_REVIEW_THRESHOLD.customer ||
      c.amounts  < NEEDS_REVIEW_THRESHOLD.amounts  ||
      c.dates    < NEEDS_REVIEW_THRESHOLD.dates    ||
      c.vatRate  < NEEDS_REVIEW_THRESHOLD.vatRate;

    await this.prisma.importArchive.update({
      where: { id: fileId },
      data:  {
        status:        'COMPLETED',
        recordCount:   1,
        extractedData: parsed as never, // store for confirm step
      },
    });

    this.logger.log(
      `Extracted import ${fileId}: overall confidence=${c.overall}, needsReview=${needsReview}`,
    );

    return {
      fileId,
      fileName:            archive.fileName,
      parsed,
      needsReview,
      needsReviewReasons:  buildReviewReasons(c),
      missingFields:       missingRequiredFields,
      notes,
      usage,
    };
  }

  // ── Get one ────────────────────────────────────────────────────────────────

  async getOne(tenantId: string, importId: string) {
    const archive = await this.prisma.importArchive.findUnique({ where: { id: importId } });
    if (!archive || archive.tenantId !== tenantId) {
      throw new NotFoundException(`Import ${importId} not found`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extracted = archive.extractedData as Record<string, any> | null;
    const conf = extracted?.['confidence'] as Record<string, number> | undefined;

    const needsReview = conf ? (
      (conf['overall']  ?? 1) < 0.85 ||
      (conf['customer'] ?? 1) < 0.70 ||
      (conf['amounts']  ?? 1) < 0.80 ||
      (conf['dates']    ?? 1) < 0.75 ||
      (conf['vatRate']  ?? 1) < 0.75
    ) : false;

    return {
      id:            archive.id,
      fileName:      archive.fileName,
      status:        archive.status,
      createdAt:     archive.createdAt,
      extractedData: extracted,
      needsReview,
    };
  }

  // ── Get PDF ────────────────────────────────────────────────────────────────

  async getPdfBuffer(tenantId: string, importId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const archive = await this.prisma.importArchive.findUnique({ where: { id: importId } });
    if (!archive || archive.tenantId !== tenantId) {
      throw new NotFoundException(`Import ${importId} not found`);
    }

    const { Body } = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: archive.s3Key }),
    );

    const chunks: Uint8Array[] = [];
    for await (const chunk of Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), fileName: archive.fileName };
  }

  // ── Reject ────────────────────────────────────────────────────────────────

  async reject(tenantId: string, importId: string) {
    const archive = await this.prisma.importArchive.findUnique({ where: { id: importId } });
    if (!archive || archive.tenantId !== tenantId) {
      throw new NotFoundException(`Import ${importId} not found`);
    }

    await this.prisma.importArchive.update({
      where: { id: importId },
      data:  { status: 'FAILED', completedAt: new Date() },
    });

    this.logger.log(`Import ${importId} rejected by tenant ${tenantId}`);
    return { importId, status: 'FAILED' };
  }

  // ── Confirm ────────────────────────────────────────────────────────────────

  async confirm(tenantId: string, importId: string, overrides: ConfirmDto = {}) {
    const archive = await this.prisma.importArchive.findUnique({ where: { id: importId } });
    if (!archive || archive.tenantId !== tenantId) {
      throw new NotFoundException(`Import ${importId} not found`);
    }
    if (archive.status !== 'COMPLETED') {
      throw new BadRequestException('Run /extract before /confirm');
    }
    if (!archive.extractedData) {
      throw new BadRequestException('No extracted data on record — re-run /extract');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = archive.extractedData as Record<string, any>;

    // ── Resolve customer contact ─────────────────────────────────────────
    let customerId = overrides.customerId;
    if (!customerId) {
      // Prefer name from the review form override, fall back to extracted
      const name: string = overrides.customerName ?? parsed['customerName'] ?? '';
      const vatNumber: string | null = overrides.customerVatNumber ?? parsed['customerVatNumber'] ?? null;
      if (name) {
        const existing = await this.prisma.contact.findFirst({
          where: { tenantId, name: { contains: name, mode: 'insensitive' }, isCustomer: true },
        });
        if (existing) {
          customerId = existing.id;
        } else {
          const created = await this.prisma.contact.create({
            data: {
              id:         crypto.randomUUID(),
              tenantId,
              name,
              country:    'EU',
              isCustomer: true,
              vatNumber,
            },
          });
          customerId = created.id;
          this.logger.log(`Auto-created customer contact "${name}" (${customerId})`);
        }
      }
    }
    if (!customerId) {
      throw new BadRequestException('customerId required — no customer name in extracted data');
    }

    // ── Build invoice DTO ──────────────────────────────────────────────────
    const dto = new CreateInvoiceBodyDto();
    dto.customerId = customerId;
    dto.currency   = (overrides.currency ?? parsed['currency'] ?? 'EUR') as string;
    dto.issueDate  = (overrides.issueDate ?? parsed['issueDate']) as string;
    dto.dueDate    = (overrides.dueDate   ?? parsed['dueDate'])   as string;
    dto.note       = (overrides.note      ?? parsed['note']       ?? undefined) as string | undefined;

    // Use corrected lines from review form if provided, otherwise fall back to extraction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawLines: Record<string, any>[] =
      overrides.lines?.length
        ? (overrides.lines as unknown as Record<string, unknown>[])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : ((parsed['lines'] as Record<string, any>[]) ?? []);

    dto.lines = rawLines.map((l): CreateInvoiceLineBodyDto => {
      const line = new CreateInvoiceLineBodyDto();
      line.itemName       = l.itemName       as string;
      line.quantity       = Number(l.quantity);
      line.unitPrice      = Number(l.unitPrice);
      line.vatRatePercent = Number(l.vatRatePercent);
      line.unitCode       = l.unitCode       as string;
      return line;
    });

    const invoice = await this.invoices.createFromApi(dto, tenantId);

    await this.prisma.importArchive.update({
      where: { id: importId },
      data:  { completedAt: new Date() },
    });

    this.logger.log(`Import ${importId} confirmed → invoice ${invoice.number}`);

    return {
      importId,
      invoiceId:     invoice.id,
      invoiceNumber: invoice.number,
      status:        invoice.status,
      total:         Number(invoice.total),
      currency:      invoice.currencyCode,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async ensureBucket() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      this.logger.log(`Bucket "${this.bucket}" not found — creating`);
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
}

function buildReviewReasons(c: {
  overall: number; customer: number; amounts: number; dates: number; vatRate: number;
}): string[] {
  const reasons: string[] = [];
  if (c.overall  < NEEDS_REVIEW_THRESHOLD.overall)  reasons.push(`low overall confidence (${c.overall})`);
  if (c.customer < NEEDS_REVIEW_THRESHOLD.customer) reasons.push(`uncertain customer name (${c.customer})`);
  if (c.amounts  < NEEDS_REVIEW_THRESHOLD.amounts)  reasons.push(`uncertain amounts (${c.amounts})`);
  if (c.dates    < NEEDS_REVIEW_THRESHOLD.dates)    reasons.push(`uncertain dates (${c.dates})`);
  if (c.vatRate  < NEEDS_REVIEW_THRESHOLD.vatRate)  reasons.push(`uncertain VAT rate (${c.vatRate})`);
  return reasons;
}
