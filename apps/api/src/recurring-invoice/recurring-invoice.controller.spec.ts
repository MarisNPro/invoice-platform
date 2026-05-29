import { Test, TestingModule } from '@nestjs/testing';
import { RecurringInvoiceController } from './recurring-invoice.controller';
import { RecurringInvoiceService } from './recurring-invoice.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

const devUser: JwtPayload = {
  sub:                'dev-user-abc',
  email:              'admin@test.ee',
  name:               'Test Admin',
  preferred_username: 'admin',
  tenant_id:          'tenant-aaa',
  iat:                0,
  exp:                9_999_999_999,
  aud:                'invoice-platform-api',
  iss:                'http://localhost:8080/realms/invoice-platform',
  realm_access:       { roles: ['invoice-admin'] },
  resource_access:    {},
};

const riFixture = {
  id:           'ri-0001',
  tenantId:     'tenant-aaa',
  customerId:   'cust-0001',
  templateLines: [{ itemName: 'Retainer', quantity: 1, unitPrice: 2500, vatRatePercent: 21, unitCode: 'MON' }],
  currency:     'EUR',
  language:     'en',
  description:  'Monthly retainer',
  intervalDays: 30,
  nextRunAt:    new Date('2026-06-01T07:00:00Z'),
  lastRunAt:    null,
  isActive:     true,
  autoSend:     false,
  createdAt:    new Date('2026-05-29'),
  updatedAt:    new Date('2026-05-29'),
  customer:     { name: 'Acme Oy', email: 'ap@acme.fi' },
};

describe('RecurringInvoiceController', () => {
  let controller: RecurringInvoiceController;
  let service: jest.Mocked<RecurringInvoiceService>;

  beforeEach(async () => {
    const mockService: Partial<jest.Mocked<RecurringInvoiceService>> = {
      create:  jest.fn(),
      findAll: jest.fn(),
      update:  jest.fn(),
      remove:  jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecurringInvoiceController],
      providers:   [{ provide: RecurringInvoiceService, useValue: mockService }],
    }).compile();

    controller = module.get(RecurringInvoiceController);
    service    = module.get(RecurringInvoiceService) as jest.Mocked<RecurringInvoiceService>;
  });

  // ── POST ──────────────────────────────────────────────────────────────────

  describe('POST /recurring-invoices', () => {
    it('calls service.create with tenantId and returns created record', async () => {
      service.create.mockResolvedValue(riFixture as any);
      const dto = {
        customerId: 'cust-0001', templateLines: riFixture.templateLines,
        intervalDays: 30, nextRunAt: '2026-06-01T07:00:00Z',
      } as any;

      const result = await controller.create(dto, devUser);

      expect(service.create).toHaveBeenCalledWith(dto, 'tenant-aaa');
      expect(result).toEqual(riFixture);
    });

    it('passes autoSend=false to service', async () => {
      service.create.mockResolvedValue({ ...riFixture, autoSend: false } as any);
      const dto = { customerId: 'cust-0001', templateLines: [], intervalDays: 30, nextRunAt: '2026-06-01T07:00:00Z', autoSend: false } as any;

      const result = await controller.create(dto, devUser) as typeof riFixture;

      expect(result.autoSend).toBe(false);
    });

    it('passes autoSend=true to service', async () => {
      service.create.mockResolvedValue({ ...riFixture, autoSend: true } as any);
      const dto = { customerId: 'cust-0001', templateLines: [], intervalDays: 30, nextRunAt: '2026-06-01T07:00:00Z', autoSend: true } as any;

      const result = await controller.create(dto, devUser) as typeof riFixture;

      expect(result.autoSend).toBe(true);
    });
  });

  // ── GET ───────────────────────────────────────────────────────────────────

  describe('GET /recurring-invoices', () => {
    it('returns array scoped to tenantId', async () => {
      service.findAll.mockResolvedValue([riFixture] as any);

      const result = await controller.findAll(devUser);

      expect(service.findAll).toHaveBeenCalledWith('tenant-aaa');
      expect(result).toEqual([riFixture]);
    });

    it('returns empty array when no recurring invoices exist', async () => {
      service.findAll.mockResolvedValue([]);

      const result = await controller.findAll(devUser);

      expect(result).toEqual([]);
    });

    it('includes inactive records (filtering is a service concern)', async () => {
      const inactive = { ...riFixture, isActive: false };
      service.findAll.mockResolvedValue([riFixture, inactive] as any);

      const result = await controller.findAll(devUser) as typeof riFixture[];

      expect(result).toHaveLength(2);
    });
  });

  // ── PATCH ─────────────────────────────────────────────────────────────────

  describe('PATCH /recurring-invoices/:id', () => {
    it('calls service.update with id, dto, and tenantId', async () => {
      service.update.mockResolvedValue({ ...riFixture, intervalDays: 60 } as any);
      const dto = { intervalDays: 60 } as any;

      const result = await controller.update('ri-0001', dto, devUser) as typeof riFixture;

      expect(service.update).toHaveBeenCalledWith('ri-0001', dto, 'tenant-aaa');
      expect(result.intervalDays).toBe(60);
    });

    it('can deactivate a recurring invoice via isActive=false', async () => {
      service.update.mockResolvedValue({ ...riFixture, isActive: false } as any);
      const dto = { isActive: false } as any;

      const result = await controller.update('ri-0001', dto, devUser) as typeof riFixture;

      expect(result.isActive).toBe(false);
    });
  });

  // ── DELETE ────────────────────────────────────────────────────────────────

  describe('DELETE /recurring-invoices/:id', () => {
    it('calls service.remove with id and tenantId', async () => {
      service.remove.mockResolvedValue({ message: 'Recurring invoice deleted', id: 'ri-0001' });

      const result = await controller.remove('ri-0001', devUser);

      expect(service.remove).toHaveBeenCalledWith('ri-0001', 'tenant-aaa');
      expect(result).toEqual({ message: 'Recurring invoice deleted', id: 'ri-0001' });
    });

    it('is tenant-scoped (tenantId from JWT)', async () => {
      service.remove.mockResolvedValue({ message: 'Recurring invoice deleted', id: 'ri-0001' });

      await controller.remove('ri-0001', devUser);

      const call = service.remove.mock.calls[0]!;
      expect(call[1]).toBe('tenant-aaa');
    });
  });
});
