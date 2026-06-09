import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateRecurringInvoiceDto } from './dto/create-recurring-invoice.dto';
import type { UpdateRecurringInvoiceDto } from './dto/update-recurring-invoice.dto';

@Injectable()
export class RecurringInvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateRecurringInvoiceDto, tenantId: string) {
    // Validate customer belongs to tenant
    const customer = await this.prisma.contact.findFirst({
      where: { id: dto.customerId, tenantId, isCustomer: true },
    });
    if (!customer) {
      throw new NotFoundException(
        `Customer ${dto.customerId} not found or does not belong to this organisation`,
      );
    }

    return this.prisma.recurringInvoice.create({
      data: {
        tenantId,
        customerId:    dto.customerId,
        templateLines: dto.templateLines as object[],
        currency:      dto.currency      ?? 'EUR',
        language:      dto.language      ?? 'en',
        description:   dto.description   ?? null,
        intervalDays:  dto.intervalDays,
        nextRunAt:     new Date(dto.nextRunAt),
        autoSend:      dto.autoSend      ?? false,
        isActive:      true,
      },
      include: { customer: { select: { name: true, email: true } } },
    });
  }

  findAll(tenantId: string) {
    return this.prisma.recurringInvoice.findMany({
      where:   { tenantId },
      include: { customer: { select: { name: true, email: true } } },
      orderBy: { nextRunAt: 'asc' },
    });
  }

  async update(id: string, dto: UpdateRecurringInvoiceDto, tenantId: string) {
    await this.findOwned(id, tenantId);

    return this.prisma.recurringInvoice.update({
      where: { id },
      data:  {
        ...(dto.templateLines !== undefined ? { templateLines: dto.templateLines as object[] } : {}),
        ...(dto.currency      !== undefined ? { currency:      dto.currency }      : {}),
        ...(dto.language      !== undefined ? { language:      dto.language }      : {}),
        ...(dto.description   !== undefined ? { description:   dto.description }   : {}),
        ...(dto.intervalDays  !== undefined ? { intervalDays:  dto.intervalDays }  : {}),
        ...(dto.nextRunAt     !== undefined ? { nextRunAt:     new Date(dto.nextRunAt) } : {}),
        ...(dto.isActive      !== undefined ? { isActive:      dto.isActive }      : {}),
        ...(dto.autoSend      !== undefined ? { autoSend:      dto.autoSend }      : {}),
      },
      include: { customer: { select: { name: true, email: true } } },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOwned(id, tenantId);
    await this.prisma.recurringInvoice.delete({ where: { id } });
    return { message: 'Recurring invoice deleted', id };
  }

  private async findOwned(id: string, tenantId: string) {
    // Scope the lookup by tenantId (rule #1) — a record owned by another tenant
    // is indistinguishable from a non-existent one, so cross-tenant access
    // returns 404 rather than leaking existence via a 403.
    const rec = await this.prisma.recurringInvoice.findFirst({
      where: { id, tenantId },
    });
    if (!rec) throw new NotFoundException(`Recurring invoice ${id} not found`);
    return rec;
  }
}
