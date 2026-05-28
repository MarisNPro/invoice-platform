import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateInvoiceBodyDto, CreateInvoiceLineBodyDto } from './create-invoice.dto';

// ── Helpers ───────────────────────────────────────────────────────────────────

const validLine = {
  itemName: 'Consulting services',
  quantity: 10,
  unitPrice: 100,
  vatRatePercent: 21,
  unitCode: 'HUR',
};

const validPayload = {
  customerId: '00000000-0000-0000-0000-000000000002',
  currency: 'EUR',
  issueDate: '2024-11-14',
  dueDate: '2024-12-14',
  lines: [validLine],
};

async function errorsFor(plain: object): Promise<string[]> {
  const dto = plainToInstance(CreateInvoiceBodyDto, plain);
  const errors = await validate(dto, { whitelist: true });
  return errors.map((e) => e.property);
}

async function lineErrorsFor(plain: object): Promise<string[]> {
  const dto = plainToInstance(CreateInvoiceLineBodyDto, plain);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

// ── CreateInvoiceBodyDto ──────────────────────────────────────────────────────

describe('CreateInvoiceBodyDto', () => {
  it('accepts a fully valid payload', async () => {
    expect(await errorsFor(validPayload)).toHaveLength(0);
  });

  it('accepts optional fields (language, note, paymentTermsNote)', async () => {
    const errors = await errorsFor({
      ...validPayload,
      language: 'lv',
      note: 'Please pay on time.',
      paymentTermsNote: '30 days net',
    });
    expect(errors).toHaveLength(0);
  });

  // customerId ──────────────────────────────────────────────────────────────

  it('rejects a plain string as customerId', async () => {
    expect(await errorsFor({ ...validPayload, customerId: 'not-a-uuid' }))
      .toContain('customerId');
  });

  it('rejects an empty customerId', async () => {
    expect(await errorsFor({ ...validPayload, customerId: '' }))
      .toContain('customerId');
  });

  it('accepts a tombstone-style (nil-version) UUID as customerId', async () => {
    // Our regex is more permissive than @IsUUID('4') — it accepts any 8-4-4-4-12 hex string
    expect(await errorsFor({ ...validPayload, customerId: '00000000-0000-0000-0000-000000000099' }))
      .not.toContain('customerId');
  });

  // currency ────────────────────────────────────────────────────────────────

  it('rejects a 2-char currency code', async () => {
    expect(await errorsFor({ ...validPayload, currency: 'EU' }))
      .toContain('currency');
  });

  it('rejects a 4-char currency code', async () => {
    expect(await errorsFor({ ...validPayload, currency: 'EURO' }))
      .toContain('currency');
  });

  it('accepts a 3-char currency code', async () => {
    expect(await errorsFor({ ...validPayload, currency: 'USD' }))
      .not.toContain('currency');
  });

  // dates ───────────────────────────────────────────────────────────────────

  it('rejects a non-ISO issueDate', async () => {
    expect(await errorsFor({ ...validPayload, issueDate: '14-11-2024' }))
      .toContain('issueDate');
  });

  it('rejects a non-ISO dueDate', async () => {
    expect(await errorsFor({ ...validPayload, dueDate: 'next month' }))
      .toContain('dueDate');
  });

  // lines ───────────────────────────────────────────────────────────────────

  it('rejects an empty lines array', async () => {
    expect(await errorsFor({ ...validPayload, lines: [] }))
      .toContain('lines');
  });

  it('rejects missing lines field', async () => {
    const { lines: _lines, ...rest } = validPayload;
    expect(await errorsFor(rest)).toContain('lines');
  });

  it('accepts multiple lines', async () => {
    const errors = await errorsFor({
      ...validPayload,
      lines: [validLine, { ...validLine, itemName: 'Project management', unitPrice: 80 }],
    });
    expect(errors).toHaveLength(0);
  });

  // language ────────────────────────────────────────────────────────────────

  it('rejects a 1-char language code', async () => {
    expect(await errorsFor({ ...validPayload, language: 'e' }))
      .toContain('language');
  });

  it('rejects a 6-char language tag', async () => {
    expect(await errorsFor({ ...validPayload, language: 'en-GBX' }))
      .toContain('language');
  });

  it('accepts a 2-char language code', async () => {
    expect(await errorsFor({ ...validPayload, language: 'lv' }))
      .not.toContain('language');
  });
});

// ── CreateInvoiceLineBodyDto ──────────────────────────────────────────────────

describe('CreateInvoiceLineBodyDto', () => {
  it('accepts a valid line', async () => {
    expect(await lineErrorsFor(validLine)).toHaveLength(0);
  });

  it('rejects negative quantity', async () => {
    expect(await lineErrorsFor({ ...validLine, quantity: -1 }))
      .toContain('quantity');
  });

  it('rejects negative unitPrice', async () => {
    expect(await lineErrorsFor({ ...validLine, unitPrice: -0.01 }))
      .toContain('unitPrice');
  });

  it('rejects negative vatRatePercent', async () => {
    expect(await lineErrorsFor({ ...validLine, vatRatePercent: -5 }))
      .toContain('vatRatePercent');
  });

  it('accepts zero vatRatePercent (zero-rated / exempt items)', async () => {
    expect(await lineErrorsFor({ ...validLine, vatRatePercent: 0 }))
      .not.toContain('vatRatePercent');
  });

  it('accepts zero quantity', async () => {
    // BT-129: zero-quantity cancellation lines are allowed by EN 16931
    expect(await lineErrorsFor({ ...validLine, quantity: 0 }))
      .not.toContain('quantity');
  });

  it('rejects empty itemName', async () => {
    expect(await lineErrorsFor({ ...validLine, itemName: '' }))
      .toContain('itemName');
  });

  it('rejects missing itemName', async () => {
    const { itemName: _name, ...rest } = validLine;
    expect(await lineErrorsFor(rest)).toContain('itemName');
  });

  it('rejects empty unitCode', async () => {
    expect(await lineErrorsFor({ ...validLine, unitCode: '' }))
      .toContain('unitCode');
  });
});
