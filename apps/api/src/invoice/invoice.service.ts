import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateInvoiceDto, InvoiceNumberRow } from './invoice.types';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Atomic numbering ──────────────────────────────────────────────────────

  /**
   * Calls the PostgreSQL `next_invoice_number(tenant_id, prefix, year)` function
   * which does an atomic INSERT … ON CONFLICT DO UPDATE on `invoice_counters`.
   *
   * Typical output: "INV-2026-00042"
   */
  async getNextInvoiceNumber(
    tenantId: string,
    prefix: string,
    year: number,
  ): Promise<string> {
    const rows = await this.prisma.$queryRaw<InvoiceNumberRow[]>(
      Prisma.sql`SELECT next_invoice_number(
        ${tenantId}::uuid,
        ${prefix}::text,
        ${year}::int
      ) AS invoice_number`,
    );

    const number = rows[0]?.invoice_number;
    if (!number) {
      throw new Error(`next_invoice_number returned no result for tenant=${tenantId}`);
    }
    return number;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async create(dto: CreateInvoiceDto) {
    const year = new Date().getFullYear();
    const prefix = dto.prefix ?? this.defaultPrefix(dto.type);

    return this.prisma.withTransaction(async (tx) => {
      // Atomic number allocation inside the same transaction
      const rows = await (tx as PrismaService).$queryRaw<InvoiceNumberRow[]>(
        Prisma.sql`SELECT next_invoice_number(
          ${dto.tenantId}::uuid,
          ${prefix}::text,
          ${year}::int
        ) AS invoice_number`,
      );
      const number = rows[0]?.invoice_number ?? '';

      // Compute line totals
      const lines = dto.lines.map((l) => {
        const net = l.quantity * l.unitPrice * (1 - (l.discount ?? 0));
        return { ...l, lineTotal: net, taxAmount: 0 }; // VAT computed by vat-engine
      });

      const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

      return (tx as PrismaService).invoice.create({
        data: {
          tenantId: dto.tenantId,
          number,
          type: dto.type,
          status: 'DRAFT',
          sellerId: dto.sellerId,
          buyerId: dto.buyerId,
          issuedAt: dto.issuedAt,
          dueAt: dto.dueAt,
          currencyCode: dto.currencyCode ?? 'EUR',
          buyerReference: dto.buyerReference,
          orderReference: dto.orderReference,
          note: dto.note,
          subtotal,
          taxAmount: 0,
          total: subtotal,
          lines: {
            create: lines.map((l) => ({
              lineNumber: l.lineNumber,
              productId: l.productId,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit ?? 'PCS',
              unitPrice: l.unitPrice,
              discount: l.discount ?? 0,
              taxRateId: l.taxRateId,
              lineTotal: l.lineTotal,
              taxAmount: l.taxAmount,
            })),
          },
        },
        include: { lines: true },
      });
    });
  }

  async findAll(tenantId: string, status?: string) {
    return this.prisma.invoice.findMany({
      where: {
        tenantId,
        ...(status ? { status: status as Prisma.EnumInvoiceStatusFilter } : {}),
      },
      include: { buyer: true, seller: true, lines: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId },
      include: {
        buyer: { include: { addresses: true } },
        seller: { include: { addresses: true } },
        lines: { include: { taxRate: true, product: true } },
        payments: true,
        attachments: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return invoice;
  }

  async markSent(tenantId: string, id: string) {
    await this.findOne(tenantId, id); // existence check
    return this.prisma.invoice.update({
      where: { id },
      data: { status: 'SENT' },
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
        data: { status: 'PAID' },
      }),
    ]);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private defaultPrefix(type: string): string {
    switch (type) {
      case 'CREDIT_NOTE': return 'CN';
      case 'DEBIT_NOTE': return 'DN';
      default: return 'INV';
    }
  }
}
