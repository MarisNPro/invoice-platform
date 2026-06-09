import { NotFoundException } from '@nestjs/common';
import { RecurringInvoiceService } from './recurring-invoice.service';

/**
 * Unit tests for tenant isolation (US-007 / R-07). The service must scope every
 * lookup by tenantId so a record owned by another tenant is unreachable — a
 * cross-tenant id resolves to 404 and never reaches the mutation.
 */
const TENANT = 'tenant-aaa';

const riFixture = {
  id:           'ri-0001',
  tenantId:     TENANT,
  customerId:   'cust-0001',
  templateLines: [],
  currency:     'EUR',
  language:     'en',
  description:  null,
  intervalDays: 30,
  nextRunAt:    new Date('2026-06-01T07:00:00Z'),
  isActive:     true,
  autoSend:     false,
};

function buildPrisma() {
  return {
    recurringInvoice: {
      findFirst: jest.fn(),
      findMany:  jest.fn(),
      create:    jest.fn(),
      update:    jest.fn(),
      delete:    jest.fn(),
    },
    contact: { findFirst: jest.fn() },
  };
}

describe('RecurringInvoiceService — tenant isolation', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: RecurringInvoiceService;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new RecurringInvoiceService(prisma as never);
  });

  describe('findAll', () => {
    it('scopes the query to the tenant', () => {
      prisma.recurringInvoice.findMany.mockResolvedValue([riFixture]);

      void service.findAll(TENANT);

      expect(prisma.recurringInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT } }),
      );
    });
  });

  describe('create', () => {
    it('rejects a customer that does not belong to the tenant', async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ customerId: 'cust-x', templateLines: [], intervalDays: 30, nextRunAt: '2026-06-01T07:00:00Z' } as never, TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-x', tenantId: TENANT, isCustomer: true },
      });
      expect(prisma.recurringInvoice.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('looks the record up scoped by id AND tenantId', async () => {
      prisma.recurringInvoice.findFirst.mockResolvedValue(riFixture);
      prisma.recurringInvoice.update.mockResolvedValue(riFixture);

      await service.update('ri-0001', { intervalDays: 60 } as never, TENANT);

      expect(prisma.recurringInvoice.findFirst).toHaveBeenCalledWith({
        where: { id: 'ri-0001', tenantId: TENANT },
      });
    });

    it('throws 404 and does not update when the record belongs to another tenant', async () => {
      prisma.recurringInvoice.findFirst.mockResolvedValue(null);

      await expect(
        service.update('ri-0001', { intervalDays: 60 } as never, 'tenant-bbb'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.recurringInvoice.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws 404 and does not delete when the record belongs to another tenant', async () => {
      prisma.recurringInvoice.findFirst.mockResolvedValue(null);

      await expect(service.remove('ri-0001', 'tenant-bbb')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(prisma.recurringInvoice.delete).not.toHaveBeenCalled();
    });

    it('deletes when the record belongs to the tenant', async () => {
      prisma.recurringInvoice.findFirst.mockResolvedValue(riFixture);
      prisma.recurringInvoice.delete.mockResolvedValue(riFixture);

      const result = await service.remove('ri-0001', TENANT);

      expect(prisma.recurringInvoice.delete).toHaveBeenCalledWith({
        where: { id: 'ri-0001' },
      });
      expect(result).toEqual({ message: 'Recurring invoice deleted', id: 'ri-0001' });
    });
  });
});
