import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateInvoiceDto, InvoiceNumberRow } from './invoice.types';
import type { CreateInvoiceBodyDto } from './dto/create-invoice.dto';

// ── Rounding helper ───────────────────────────────────────────────────────────

/** Round to 2 decimal places using "round half away from zero" */
const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

// ── VAT category inference ────────────────────────────────────────────────────

/** Infer EN 16931 BT-118 category code from rate percentage */
function vatCategoryCode(ratePercent: number): string {
  if (ratePercent === 0) return 'Z';   // zero-rated
  return 'S';                           // standard rated — extend for AE/E/K as needed
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Primary create endpoint (API-facing) ──────────────────────────────────

  /**
   * Creates a new DRAFT invoice from the user-facing DTO.
   *
   * Steps:
   *  1. Load Tenant (organisation) from tenantId JWT claim
   *  2. Load Customer Contact, validate same org
   *  3. Resolve Seller Contact (own-company entry for this tenant)
   *  4. Resolve optional DB user for createdById
   *  5. Match tax rates for lines
   *  6. Calculate per-line netAmount (quantity × unitPrice)
   *  7. Group lines by vatRatePercent → VAT breakdown table (BG-23)
   *  8. BG-22 totals: lineExtensionAmount, taxAmount, taxInclusiveAmount,
   *     duePayableAmount
   *  9. Single Prisma transaction: Invoice + InvoiceLines + InvoiceVatBreakdowns
   * 10. AuditLog entry
   * 11. Return full invoice with lines + vatBreakdowns
   */
  async createFromApi(
    dto:        CreateInvoiceBodyDto,
    tenantId:   string,
    keycloakSub?: string,
    ipAddress?:   string,
  ) {
    // ── 1. Load Tenant ──────────────────────────────────────────────────────
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException(`Organisation ${tenantId} not found`);

    // ── 2. Load Customer, validate same org ─────────────────────────────────
    const customer = await this.prisma.contact.findFirst({
      where: { id: dto.customerId },
      include: { addresses: { where: { isDefault: true }, take: 1 } },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${dto.customerId} not found`);
    }
    if (customer.tenantId !== tenantId) {
      throw new ForbiddenException('Customer belongs to a different organisation');
    }
    if (!customer.isCustomer) {
      throw new ForbiddenException(`Contact ${dto.customerId} is not marked as a customer`);
    }

    // ── 3. Resolve Seller Contact (own-company for this tenant) ─────────────
    // Seller = a Contact that belongs to this tenant with isCustomer=false.
    // The seed creates exactly one such contact per tenant (the "self" entry).
    const seller = await this.prisma.contact.findFirst({
      where:   { tenantId, isCustomer: false },
      include: { addresses: { where: { isDefault: true }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });
    if (!seller) {
      throw new NotFoundException(
        `No seller contact found for organisation ${tenantId}. ` +
        'Create a self-contact (isCustomer: false) first.',
      );
    }

    // ── 4. Resolve DB user for createdById (optional) ───────────────────────
    let dbUserId: string | null = null;
    if (keycloakSub) {
      const dbUser = await this.prisma.user.findFirst({
        where: { keycloakId: keycloakSub },
        select: { id: true },
      });
      dbUserId = dbUser?.id ?? null;
    }

    // ── 5. Pre-load tenant tax rates for taxRateId resolution ────────────────
    const tenantTaxRates = await this.prisma.taxRate.findMany({
      where: { tenantId },
    });

    function findTaxRateId(ratePercent: number): string | null {
      // Match by fractional rate: 21% → 0.21
      const match = tenantTaxRates.find(
        (tr) => Math.abs(Number(tr.rate) - ratePercent / 100) < 0.0001,
      );
      return match?.id ?? null;
    }

    // ── 6. Per-line net amounts ──────────────────────────────────────────────
    const enrichedLines = dto.lines.map((line, idx) => ({
      lineNumber:    idx + 1,
      description:   line.itemName,
      quantity:      line.quantity,
      unitPrice:     line.unitPrice,
      unit:          line.unitCode,
      vatRatePercent: line.vatRatePercent,
      taxRateId:     findTaxRateId(line.vatRatePercent),
      netAmount:     round2(line.quantity * line.unitPrice),
      lineTaxAmount: round2(round2(line.quantity * line.unitPrice) * line.vatRatePercent / 100),
    }));

    // ── 7. VAT breakdown per rate (BG-23) ────────────────────────────────────
    const vatGroupMap = new Map<number, number>(); // rate% → taxableAmount
    for (const line of enrichedLines) {
      vatGroupMap.set(
        line.vatRatePercent,
        round2((vatGroupMap.get(line.vatRatePercent) ?? 0) + line.netAmount),
      );
    }

    const vatBreakdowns = Array.from(vatGroupMap.entries()).map(([rate, taxable]) => ({
      vatCategoryCode: vatCategoryCode(rate),
      vatRatePercent:  rate,
      taxableAmount:   taxable,
      taxAmount:       round2(taxable * rate / 100),
    }));

    // ── 8. BG-22 document totals ─────────────────────────────────────────────
    const lineExtensionAmount = round2(enrichedLines.reduce((s, l) => s + l.netAmount, 0));
    const taxAmount            = round2(vatBreakdowns.reduce((s, vb) => s + vb.taxAmount, 0));
    const taxInclusiveAmount   = round2(lineExtensionAmount + taxAmount);
    const duePayableAmount     = taxInclusiveAmount; // no prepaid amount in this version

    const year   = new Date(dto.issueDate).getFullYear();
    const prefix = 'INV';

    // ── 9. Single transaction: Invoice + Lines + VatBreakdowns ───────────────
    const invoice = await this.prisma.withTransaction(async (tx) => {
      // Atomic invoice number — guaranteed unique even under concurrency
      const rows = await (tx as PrismaService).$queryRaw<InvoiceNumberRow[]>(
        Prisma.sql`SELECT next_invoice_number(
          ${tenantId}::uuid,
          ${prefix}::text,
          ${year}::int
        ) AS invoice_number`,
      );
      const number = rows[0]?.invoice_number;
      if (!number) throw new Error('next_invoice_number returned no result');

      const created = await (tx as PrismaService).invoice.create({
        data: {
          tenantId,
          number,
          type:             'INVOICE',
          status:           'DRAFT',
          sellerId:         seller.id,
          buyerId:          customer.id,
          issuedAt:         new Date(dto.issueDate),
          dueAt:            new Date(dto.dueDate),
          currencyCode:     dto.currency,
          language:         dto.language ?? 'en',
          note:             dto.note             ?? null,
          paymentTermsNote: dto.paymentTermsNote ?? null,
          subtotal:         lineExtensionAmount,
          taxAmount,
          total:            taxInclusiveAmount,
          createdById:      dbUserId,

          // BG-25 invoice lines
          lines: {
            create: enrichedLines.map((line) => ({
              lineNumber:  line.lineNumber,
              description: line.description,
              quantity:    line.quantity,
              unit:        line.unit,
              unitPrice:   line.unitPrice,
              discount:    0,
              taxRateId:   line.taxRateId,
              lineTotal:   line.netAmount,
              taxAmount:   line.lineTaxAmount,
            })),
          },

          // BG-23 VAT breakdown rows
          vatBreakdowns: {
            create: vatBreakdowns,
          },
        },
        include: {
          lines:        { include: { taxRate: true } },
          vatBreakdowns: true,
          buyer:        { include: { addresses: true } },
          seller:       { include: { addresses: true } },
        },
      });

      // ── 10. Audit log ────────────────────────────────────────────────────
      await (tx as PrismaService).auditLog.create({
        data: {
          tenantId,
          invoiceId: created.id,
          userId:    keycloakSub ?? null,
          action:    'invoice.created',
          payload:   {
            number,
            currency:            dto.currency,
            lineExtensionAmount,
            taxAmount,
            taxInclusiveAmount,
            duePayableAmount,
            linesCount:          enrichedLines.length,
          },
          ipAddress: ipAddress ?? null,
        },
      });

      return created;
    });

    // ── 11. Return full invoice ──────────────────────────────────────────────
    this.logger.log(
      `Invoice created: ${invoice.number} | tenant=${tenantId} | ` +
      `net=${lineExtensionAmount} tax=${taxAmount} total=${taxInclusiveAmount} ${dto.currency}`,
    );

    return {
      ...invoice,
      // Expose BG-22 totals under their EN 16931 names for API consumers
      totals: {
        lineExtensionAmount,
        taxAmount,
        taxInclusiveAmount,
        duePayableAmount,
        currency: dto.currency,
      },
    };
  }

  // ── Legacy internal create (kept for backward compatibility) ──────────────

  async create(dto: CreateInvoiceDto) {
    const year   = new Date().getFullYear();
    const prefix = dto.prefix ?? this.defaultPrefix(dto.type);

    return this.prisma.withTransaction(async (tx) => {
      const rows = await (tx as PrismaService).$queryRaw<InvoiceNumberRow[]>(
        Prisma.sql`SELECT next_invoice_number(
          ${dto.tenantId}::uuid,
          ${prefix}::text,
          ${year}::int
        ) AS invoice_number`,
      );
      const number = rows[0]?.invoice_number ?? '';

      const lines = dto.lines.map((l) => {
        const net = round2(l.quantity * l.unitPrice * (1 - (l.discount ?? 0)));
        return { ...l, lineTotal: net, taxAmount: 0 };
      });

      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

      return (tx as PrismaService).invoice.create({
        data: {
          tenantId:      dto.tenantId,
          number,
          type:          dto.type,
          status:        'DRAFT',
          sellerId:      dto.sellerId,
          buyerId:       dto.buyerId,
          issuedAt:      dto.issuedAt,
          dueAt:         dto.dueAt,
          currencyCode:  dto.currencyCode ?? 'EUR',
          buyerReference: dto.buyerReference,
          orderReference: dto.orderReference,
          note:          dto.note,
          subtotal,
          taxAmount:     0,
          total:         subtotal,
          lines: {
            create: lines.map((l) => ({
              lineNumber:  l.lineNumber,
              productId:   l.productId,
              description: l.description,
              quantity:    l.quantity,
              unit:        l.unit ?? 'PCS',
              unitPrice:   l.unitPrice,
              discount:    l.discount ?? 0,
              taxRateId:   l.taxRateId,
              lineTotal:   l.lineTotal,
              taxAmount:   l.taxAmount,
            })),
          },
        },
        include: { lines: true },
      });
    });
  }

  // ── List & single fetch ──────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    status?:  string,
    page    = 1,
    limit   = 20,
  ) {
    const skip = (page - 1) * limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where:   { tenantId, ...(status ? { status: status as Prisma.EnumInvoiceStatusFilter } : {}) },
        include: { buyer: true, seller: true, _count: { select: { lines: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.invoice.count({
        where: { tenantId, ...(status ? { status: status as Prisma.EnumInvoiceStatusFilter } : {}) },
      }),
    ]);

    return {
      data: items,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async findOne(tenantId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId },
      include: {
        buyer:         { include: { addresses: true } },
        seller:        { include: { addresses: true } },
        lines:         { include: { taxRate: true, product: true }, orderBy: { lineNumber: 'asc' } },
        vatBreakdowns: { orderBy: { vatRatePercent: 'asc' } },
        payments:      true,
        attachments:   true,
      },
    });

    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  // ── Status mutations ─────────────────────────────────────────────────────────

  async markSent(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.invoice.update({
      where: { id },
      data:  { status: 'SENT' },
    });
  }

  async markPaid(tenantId: string, id: string, amount: number, paidAt: Date) {
    await this.findOne(tenantId, id);
    return this.prisma.$transaction([
      this.prisma.payment.create({
        data: { invoiceId: id, amount, paidAt, method: 'BANK_TRANSFER' },
      }),
      this.prisma.invoice.update({
        where: { id },
        data:  { status: 'PAID' },
      }),
    ]);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private defaultPrefix(type: string): string {
    switch (type) {
      case 'CREDIT_NOTE': return 'CN';
      case 'DEBIT_NOTE':  return 'DN';
      default:            return 'INV';
    }
  }
}
