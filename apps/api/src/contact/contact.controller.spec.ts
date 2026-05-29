import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ContactController } from './contact.controller';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const devUser: JwtPayload = {
  sub: 'dev-00000001', email: 'dev@localhost', iat: 0, exp: 9_999_999_999,
  aud: 'invoice-platform-api', iss: 'http://localhost:8080/realms/invoice-platform',
  tenant_id: TENANT_ID, realm_access: { roles: ['invoice-admin'] }, resource_access: {},
};

const acme = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  name: 'Acme Oy', vatNumber: 'FI12345678', businessId: '1234567-8',
  country: 'FI', email: 'accounts@acme.fi', phone: null,
  tenantId: TENANT_ID, isCustomer: true, isSupplier: false,
  iban: null, bic: null, createdAt: new Date(), updatedAt: new Date(),
  addresses: [{ street: 'Mannerheimintie 1', city: 'Helsinki', postalCode: '00100', country: 'FI', isDefault: true }],
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ContactController', () => {
  let controller: ContactController;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      contact: {
        findMany:  jest.fn(),
        findFirst: jest.fn(),
      },
      invoice: {
        groupBy: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContactController],
      providers:   [{ provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    controller = module.get(ContactController);
    prisma     = module.get(PrismaService) as jest.Mocked<PrismaService>;
  });

  // ── search ───────────────────────────────────────────────────────────────

  describe('GET /contacts', () => {
    it('returns contacts scoped to tenant', async () => {
      (prisma.contact.findMany as jest.Mock).mockResolvedValue([acme]);
      const result = await controller.search(devUser, undefined, 'true', 20);
      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_ID }) }),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ── getCustomers ─────────────────────────────────────────────────────────

  describe('GET /contacts/customers', () => {
    it('returns customers with aggregated invoice stats', async () => {
      (prisma.contact.findMany as jest.Mock).mockResolvedValue([acme]);
      (prisma.invoice.groupBy as jest.Mock).mockResolvedValue([
        { buyerId: acme.id, _count: { _all: 3 }, _sum: { total: 1500 }, _max: { issuedAt: new Date('2026-05-01') } },
      ]);

      const result = (await controller.getCustomers(devUser)) as { invoiceCount: number; totalInvoiced: number }[];
      expect(result[0]!.invoiceCount).toBe(3);
      expect(result[0]!.totalInvoiced).toBe(1500);
      expect(prisma.invoice.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['buyerId'] }),
      );
    });

    it('returns invoiceCount=0 for customers with no invoices', async () => {
      (prisma.contact.findMany as jest.Mock).mockResolvedValue([acme]);
      (prisma.invoice.groupBy as jest.Mock).mockResolvedValue([]);

      const result = (await controller.getCustomers(devUser)) as { invoiceCount: number }[];
      expect(result[0]!.invoiceCount).toBe(0);
    });

    it('returns empty array when tenant has no customers', async () => {
      (prisma.contact.findMany as jest.Mock).mockResolvedValue([]);
      const result = await controller.getCustomers(devUser);
      expect(result).toEqual([]);
      expect(prisma.invoice.groupBy).not.toHaveBeenCalled();
    });
  });

  // ── getOne ────────────────────────────────────────────────────────────────

  describe('GET /contacts/:id', () => {
    it('returns contact when found for this tenant', async () => {
      (prisma.contact.findFirst as jest.Mock).mockResolvedValue(acme);
      const result = await controller.getOne(acme.id, devUser);
      expect(prisma.contact.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: acme.id, tenantId: TENANT_ID } }),
      );
      expect(result).toEqual(acme);
    });

    it('throws NotFoundException when contact not found', async () => {
      (prisma.contact.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(controller.getOne('nonexistent', devUser)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
