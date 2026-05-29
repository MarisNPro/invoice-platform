import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import type { InvoiceStatus, ImportStatus } from '@prisma/client';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const FILE_ID   = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const devUser: JwtPayload = {
  sub:               'dev-user-00000000-0000-0000-0000-000000000001',
  email:             'dev@localhost',
  name:              'Dev User',
  preferred_username: 'dev',
  tenant_id:         TENANT_ID,
  iat: 0, exp: 9_999_999_999,
  aud: 'invoice-platform-api',
  iss: 'http://localhost:8080/realms/invoice-platform',
  realm_access:    { roles: ['invoice-admin'] },
  resource_access: {},
};

const uploadResult = {
  fileId:   FILE_ID as `${string}-${string}-${string}-${string}-${string}`,
  fileName: 'invoice.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 3590,
};

const extractResult = {
  fileId:   FILE_ID,
  fileName: 'invoice.pdf',
  parsed: {
    customerName: 'Acme Oy',
    currency:     'EUR',
    issueDate:    '2026-05-14',
    dueDate:      '2026-05-21',
    lines: [
      { itemName: 'Consulting', quantity: 10, unitPrice: 100, vatRatePercent: 21, unitCode: 'HUR' },
    ],
    confidence: { overall: 0.99, customer: 1, amounts: 1, dates: 1, vatRate: 1 },
  },
  needsReview:        false,
  needsReviewReasons: [],
  missingFields:      ['customerId'],
  notes:              ['Resolve customerId: ...'],
  usage: { inputTokens: 2502, outputTokens: 372, cacheReadInputTokens: 0, cacheCreationInputTokens: 2035 },
};

const confirmResult = {
  importId:      FILE_ID,
  invoiceId:     'ffffffff-ffff-ffff-ffff-ffffffffffff',
  invoiceNumber: 'INV-2026-00003',
  status:        'DRAFT' as InvoiceStatus,
  total:         1210,
  currency:      'EUR',
};

const listResult = [
  {
    id:                     FILE_ID,
    fileName:               'invoice.pdf',
    status:                 'COMPLETED' as const,
    createdAt:              new Date('2026-05-28'),
    completedAt:            new Date('2026-05-28'),
    confidencePct:          99,
    confirmedInvoiceNumber: 'INV-2026-00003',
  },
];

const archiveResult = {
  id:            FILE_ID,
  fileName:      'invoice.pdf',
  status:        'COMPLETED' as ImportStatus,
  createdAt:     new Date('2026-05-28'),
  extractedData: extractResult.parsed as Record<string, unknown>,
  needsReview:   false,
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ImportController', () => {
  let controller: ImportController;
  let service:    jest.Mocked<ImportService>;

  beforeEach(async () => {
    const mockService: Partial<jest.Mocked<ImportService>> = {
      upload:       jest.fn(),
      extract:      jest.fn(),
      confirm:      jest.fn(),
      findAll:      jest.fn(),
      getOne:       jest.fn(),
      reject:       jest.fn(),
      getPdfBuffer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImportController],
      providers:   [{ provide: ImportService, useValue: mockService }],
    }).compile();

    controller = module.get(ImportController);
    service    = module.get(ImportService) as jest.Mocked<ImportService>;
  });

  // ── upload ───────────────────────────────────────────────────────────────

  describe('POST /imports/upload', () => {
    it('returns fileId + metadata after successful upload', async () => {
      service.upload.mockResolvedValue(uploadResult);

      const mockFile = {
        filename:  'invoice.pdf',
        mimetype:  'application/pdf',
        toBuffer:  jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
      };
      const mockReq = { file: jest.fn().mockResolvedValue(mockFile) };

      const result = await controller.upload(mockReq as never, devUser);

      expect(service.upload).toHaveBeenCalledWith(
        TENANT_ID,
        expect.any(Buffer),
        'invoice.pdf',
        'application/pdf',
      );
      expect(result.fileId).toBe(FILE_ID);
      expect(result.sizeBytes).toBe(3590);
    });

    it('throws BadRequestException when no file is attached', async () => {
      const mockReq = { file: jest.fn().mockResolvedValue(null) };
      await expect(
        controller.upload(mockReq as never, devUser),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.upload).not.toHaveBeenCalled();
    });
  });

  // ── extract ──────────────────────────────────────────────────────────────

  describe('POST /imports/extract', () => {
    it('returns extracted invoice data with confidence scores', async () => {
      service.extract.mockResolvedValue(extractResult);

      const result = await controller.extract({ fileId: FILE_ID }, devUser);

      expect(service.extract).toHaveBeenCalledWith(TENANT_ID, FILE_ID);
      expect(result.parsed.confidence.overall).toBe(0.99);
      expect(result.parsed.customerName).toBe('Acme Oy');
      expect(result.needsReview).toBe(false);
    });

    it('passes needsReview=true when confidence is low', async () => {
      const lowConf = {
        ...extractResult,
        parsed: {
          ...extractResult.parsed,
          confidence: { overall: 0.6, customer: 0.5, amounts: 0.7, dates: 0.6, vatRate: 0.5 },
        },
        needsReview: true,
        needsReviewReasons: ['low overall confidence (0.6)', 'uncertain customer name (0.5)'],
      };
      service.extract.mockResolvedValue(lowConf);

      const result = await controller.extract({ fileId: FILE_ID }, devUser);

      expect(result.needsReview).toBe(true);
      expect(result.needsReviewReasons).toHaveLength(2);
    });
  });

  // ── confirm ──────────────────────────────────────────────────────────────

  describe('POST /imports/:id/confirm', () => {
    it('returns invoiceNumber after creating invoice', async () => {
      service.confirm.mockResolvedValue(confirmResult);

      const result = await controller.confirm(FILE_ID, {}, devUser);

      expect(service.confirm).toHaveBeenCalledWith(TENANT_ID, FILE_ID, {});
      expect(result.invoiceNumber).toBe('INV-2026-00003');
      expect(result.status).toBe('DRAFT');
    });

    it('passes corrected form data to service', async () => {
      service.confirm.mockResolvedValue(confirmResult);
      const dto = {
        customerName: 'Acme Oy (corrected)',
        currency:     'EUR',
        issueDate:    '2026-05-15',
        dueDate:      '2026-06-14',
        lines: [{ itemName: 'Consulting', quantity: 8, unitPrice: 120, vatRatePercent: 21, unitCode: 'HUR' }],
      };

      await controller.confirm(FILE_ID, dto, devUser);

      expect(service.confirm).toHaveBeenCalledWith(TENANT_ID, FILE_ID, dto);
    });
  });

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('GET /imports', () => {
    it('returns list with status and confidence for tenant', async () => {
      service.findAll.mockResolvedValue(listResult);

      const result = await controller.findAll(devUser);

      expect(service.findAll).toHaveBeenCalledWith(TENANT_ID);
      expect(result).toHaveLength(1);
      expect(result[0]!.confirmedInvoiceNumber).toBe('INV-2026-00003');
      expect(result[0]!.confidencePct).toBe(99);
    });
  });

  // ── getOne ───────────────────────────────────────────────────────────────

  describe('GET /imports/:id', () => {
    it('returns archive with extractedData and needsReview flag', async () => {
      service.getOne.mockResolvedValue(archiveResult);

      const result = await controller.getOne(FILE_ID, devUser);

      expect(service.getOne).toHaveBeenCalledWith(TENANT_ID, FILE_ID);
      expect(result.id).toBe(FILE_ID);
      expect(result.needsReview).toBe(false);
      expect(result.extractedData).toBeDefined();
    });
  });

  // ── reject ───────────────────────────────────────────────────────────────

  describe('POST /imports/:id/reject', () => {
    it('marks import as FAILED', async () => {
      service.reject.mockResolvedValue({ importId: FILE_ID, status: 'FAILED' });

      const result = await controller.reject(FILE_ID, devUser);

      expect(service.reject).toHaveBeenCalledWith(TENANT_ID, FILE_ID);
      expect(result.status).toBe('FAILED');
    });
  });
});
