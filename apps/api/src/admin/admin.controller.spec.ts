import { Test, TestingModule } from '@nestjs/testing';
import type { Plan } from '@prisma/client';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────


const orgFixture = {
  id:                  '11111111-1111-1111-1111-111111111111',
  legalName:           'Acme GmbH',
  vatNumber:           'DE123456789' as string | null,
  country:             'DE',
  planTier:            'BUSINESS' as Plan,
  planStartedAt:       new Date('2026-01-01') as Date | null,
  planExpiresAt:       null as Date | null,
  monthlyInvoiceCount: 12,
  monthlyInvoiceLimit: 200,
  monthlyAiCallCount:  5,
  monthlyAiCallLimit:  -1,
  monthlyAiSpendCents: 340,
  monthlyAiSpendLimit: -1,
  userCount:           3,
  invoiceCount:        42,
  createdAt:           new Date('2025-11-01'),
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('AdminController', () => {
  let controller: AdminController;
  let service: jest.Mocked<AdminService>;

  beforeEach(async () => {
    const mockService: Partial<jest.Mocked<AdminService>> = {
      getOrganisations:      jest.fn(),
      updatePlan:            jest.fn(),
      resetCounters:         jest.fn(),
      getUsers:              jest.fn(),
      impersonateUser:       jest.fn(),
      disableUser:           jest.fn(),
      getAuditLogs:          jest.fn(),
      getApiKeys:            jest.fn(),
      revokeApiKey:          jest.fn(),
      getSessions:           jest.fn(),
      terminateUserSessions: jest.fn(),
      getSystemHealth:       jest.fn(),
      getAiCosts:            jest.fn(),
      getVatRates:           jest.fn(),
      updateVatRate:         jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers:   [{ provide: AdminService, useValue: mockService }],
    }).compile();

    controller = module.get(AdminController);
    service    = module.get(AdminService) as jest.Mocked<AdminService>;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GET /admin/organisations
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /admin/organisations', () => {
    it('returns all organisations when no filters are provided', async () => {
      service.getOrganisations.mockResolvedValue([orgFixture]);

      const result = await controller.getOrganisations();

      expect(service.getOrganisations).toHaveBeenCalledWith({
        tier:    undefined,
        country: undefined,
        search:  undefined,
      });
      expect(result).toEqual([orgFixture]);
    });

    it('forwards tier, country, and search query params to the service', async () => {
      service.getOrganisations.mockResolvedValue([]);

      await controller.getOrganisations('BUSINESS', 'DE', 'acme');

      expect(service.getOrganisations).toHaveBeenCalledWith({
        tier:    'BUSINESS',
        country: 'DE',
        search:  'acme',
      });
    });

    it('returns empty array when no organisations match', async () => {
      service.getOrganisations.mockResolvedValue([]);

      const result = await controller.getOrganisations(undefined, undefined, 'nonexistent');

      expect(result).toEqual([]);
    });

    it('includes plan usage fields in each organisation', async () => {
      service.getOrganisations.mockResolvedValue([orgFixture]);

      const result = await controller.getOrganisations();
      const org    = (result as typeof orgFixture[])[0]!;

      expect(org.planTier).toBe('BUSINESS');
      expect(org.monthlyInvoiceCount).toBe(12);
      expect(org.monthlyAiSpendCents).toBe(340);
      expect(org.userCount).toBe(3);
      expect(org.invoiceCount).toBe(42);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GET /admin/system-health
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /admin/system-health', () => {
    const healthFixture = {
      postgres:      { status: 'up' as const,   responseMs: 3  },
      redis:         { status: 'up' as const,   responseMs: 1  },
      keycloak:      { status: 'up' as const,   responseMs: 45 },
      minio:         { status: 'up' as const,   responseMs: 20 },
      bullmq: {
        queues: [
          { name: 'invoice-email',     waiting: 0, active: 0, completed: 99, failed: 0, delayed: 0 },
          { name: 'dunning-scheduler', waiting: 0, active: 0, completed: 12, failed: 0, delayed: 0 },
          { name: 'monthly-reset',     waiting: 0, active: 0, completed:  6, failed: 0, delayed: 0 },
          { name: 'company-sync',      waiting: 0, active: 0, completed: 30, failed: 1, delayed: 0 },
        ],
        responseMs: 5,
      },
      overall:   'healthy' as const,
      checkedAt: '2026-05-28T00:00:00.000Z',
    };

    it('calls the service and returns the health report', async () => {
      service.getSystemHealth.mockResolvedValue(healthFixture);

      const result = await controller.getSystemHealth();

      expect(service.getSystemHealth).toHaveBeenCalledTimes(1);
      expect(result).toEqual(healthFixture);
    });

    it('reports overall=healthy when all services are up', async () => {
      service.getSystemHealth.mockResolvedValue(healthFixture);

      const result = await controller.getSystemHealth() as typeof healthFixture;

      expect(result.overall).toBe('healthy');
    });

    it('reports overall=degraded when a service is down', async () => {
      const degraded = {
        ...healthFixture,
        redis:   { status: 'down' as const, responseMs: -1 },
        overall: 'degraded' as const,
      };
      service.getSystemHealth.mockResolvedValue(degraded);

      const result = await controller.getSystemHealth() as typeof degraded;

      expect(result.overall).toBe('degraded');
      expect(result.redis.status).toBe('down');
    });

    it('returns BullMQ queue stats for all 4 queues', async () => {
      service.getSystemHealth.mockResolvedValue(healthFixture);

      const result = await controller.getSystemHealth() as typeof healthFixture;

      expect(result.bullmq.queues).toHaveLength(4);
      const names = result.bullmq.queues.map((q) => q.name);
      expect(names).toContain('invoice-email');
      expect(names).toContain('dunning-scheduler');
      expect(names).toContain('monthly-reset');
      expect(names).toContain('company-sync');
    });

    it('includes a checkedAt ISO timestamp', async () => {
      service.getSystemHealth.mockResolvedValue(healthFixture);

      const result = await controller.getSystemHealth() as typeof healthFixture;

      expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
