/**
 * Unit tests for UblInvoiceBuilder (pure — no database, no DI).
 *
 * Tests verify:
 *  - Well-formed XML declaration
 *  - UBL 2.1 root namespace declarations
 *  - BT-24 CustomizationID (Peppol BIS 3.0)
 *  - BT-23 ProfileID
 *  - BT-1 invoice number, BT-2 issue date, BT-3 type code
 *  - BG-22 all monetary totals match input values (BT-106/109/112/113/115 + BT-110)
 *  - BG-23 TaxSubtotal per rate
 *  - BG-4  seller VAT / registration
 *  - BG-7  buyer VAT
 *  - BT-84 IBAN in PaymentMeans
 *  - BG-25 correct number of InvoiceLine elements
 *  - Credit-note type code 381
 *  - Default Peppol identifiers when customizationId/profileId are omitted
 */

import { UblInvoiceBuilder } from '@invoice/ubl-builder';
import type { UblInvoiceInput } from '@invoice/ubl-builder';

// ── Shared test fixture ───────────────────────────────────────────────────────

const SELLER_IBAN = 'EE382200221020145685';

const BASE_INPUT: UblInvoiceInput = {
  invoiceNumber: 'INV-2024-00002',
  typeCode:      '380',
  issueDate:     '2024-11-14',
  dueDate:       '2024-12-14',
  currencyCode:  'EUR',
  seller: {
    name:               'Dev Company OÜ',
    vatNumber:          'EE123456789',
    registrationNumber: '12345678',
    street:             'Tartu mnt 16',
    city:               'Tallinn',
    postalCode:         '10115',
    country:            'EE',
    iban:               SELLER_IBAN,
    bic:                'HABAEE2X',
  },
  buyer: {
    name:      'Acme Oy',
    vatNumber: 'FI12345678',
    street:    'Mannerheimintie 12',
    city:      'Helsinki',
    postalCode: '00100',
    country:   'FI',
    email:     'accounts@acme.fi',
  },
  lines: [
    {
      id:                  1,
      description:         'Consulting services',
      quantity:            10,
      unitCode:            'HUR',
      unitPrice:           100,
      lineExtensionAmount: 1000,
      taxCategoryCode:     'S',
      taxPercent:          21,
      taxAmount:           210,
    },
    {
      id:                  2,
      description:         'Project management',
      quantity:            5,
      unitCode:            'HUR',
      unitPrice:           80,
      lineExtensionAmount: 400,
      taxCategoryCode:     'S',
      taxPercent:          21,
      taxAmount:           84,
    },
  ],
  taxAmount:     294,
  taxableAmount: 1400,
  payableAmount: 1694,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UblInvoiceBuilder', () => {
  let builder: UblInvoiceBuilder;
  let xml: string;

  beforeAll(() => {
    builder = new UblInvoiceBuilder();
    xml     = builder.build(BASE_INPUT);
  });

  // ── Document structure ────────────────────────────────────────────────────

  it('produces well-formed XML with declaration', () => {
    expect(xml.trimStart()).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  });

  it('has Invoice root element with UBL 2.1 namespace', () => {
    expect(xml).toContain(
      'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"',
    );
  });

  it('declares cac and cbc namespaces', () => {
    expect(xml).toContain(
      'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"',
    );
    expect(xml).toContain(
      'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"',
    );
  });

  // ── BT-24 / BT-23 ────────────────────────────────────────────────────────

  it('BT-24: CustomizationID is Peppol BIS Billing 3.0', () => {
    expect(xml).toContain(
      'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    );
  });

  it('BT-23: ProfileID is Peppol billing process', () => {
    expect(xml).toContain('urn:fdc:peppol.eu:2017:poacc:billing:01:1.0');
  });

  it('uses default Peppol identifiers when not explicitly supplied', () => {
    const { customizationId: _c, profileId: _p, ...rest } = BASE_INPUT as UblInvoiceInput & {
      customizationId?: string; profileId?: string;
    };
    const out = builder.build(rest);
    expect(out).toContain(
      'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    );
    expect(out).toContain('urn:fdc:peppol.eu:2017:poacc:billing:01:1.0');
  });

  // ── Header fields ─────────────────────────────────────────────────────────

  it('BT-1: invoice number', () => {
    expect(xml).toContain('<cbc:ID>INV-2024-00002</cbc:ID>');
  });

  it('BT-2: issue date in YYYY-MM-DD', () => {
    expect(xml).toContain('<cbc:IssueDate>2024-11-14</cbc:IssueDate>');
  });

  it('BT-9: due date in YYYY-MM-DD', () => {
    expect(xml).toContain('<cbc:DueDate>2024-12-14</cbc:DueDate>');
  });

  it('BT-3: invoice type code 380', () => {
    expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
  });

  it('credit note uses type code 381', () => {
    const out = builder.build({ ...BASE_INPUT, typeCode: '381' });
    expect(out).toContain('<cbc:InvoiceTypeCode>381</cbc:InvoiceTypeCode>');
  });

  // ── BG-4 Seller ───────────────────────────────────────────────────────────

  it('BT-27: seller registration name', () => {
    expect(xml).toContain('Dev Company OÜ');
  });

  it('BT-31: seller VAT number', () => {
    expect(xml).toContain('<cbc:CompanyID>EE123456789</cbc:CompanyID>');
  });

  it('BT-30: seller registration number', () => {
    expect(xml).toContain('<cbc:CompanyID>12345678</cbc:CompanyID>');
  });

  // ── BG-7 Buyer ────────────────────────────────────────────────────────────

  it('BT-44: buyer registration name', () => {
    expect(xml).toContain('Acme Oy');
  });

  it('BT-48: buyer VAT number', () => {
    expect(xml).toContain('<cbc:CompanyID>FI12345678</cbc:CompanyID>');
  });

  // ── Payment means ─────────────────────────────────────────────────────────

  it('BT-84: IBAN in PayeeFinancialAccount', () => {
    expect(xml).toContain(SELLER_IBAN);
  });

  it('BT-85: BIC in FinancialInstitutionBranch', () => {
    expect(xml).toContain('HABAEE2X');
  });

  // ── BG-22 Document totals ─────────────────────────────────────────────────

  it('BT-106: LineExtensionAmount matches taxableAmount', () => {
    expect(xml).toContain(
      '<cbc:LineExtensionAmount currencyID="EUR">1400.00</cbc:LineExtensionAmount>',
    );
  });

  it('BT-109: TaxExclusiveAmount matches taxableAmount', () => {
    expect(xml).toContain(
      '<cbc:TaxExclusiveAmount currencyID="EUR">1400.00</cbc:TaxExclusiveAmount>',
    );
  });

  it('BT-110: TaxTotal TaxAmount matches taxAmount', () => {
    expect(xml).toContain(
      '<cbc:TaxAmount currencyID="EUR">294.00</cbc:TaxAmount>',
    );
  });

  it('BT-112: TaxInclusiveAmount matches payableAmount', () => {
    expect(xml).toContain(
      '<cbc:TaxInclusiveAmount currencyID="EUR">1694.00</cbc:TaxInclusiveAmount>',
    );
  });

  it('BT-113: PrepaidAmount is 0.00 for a fresh invoice', () => {
    expect(xml).toContain(
      '<cbc:PrepaidAmount currencyID="EUR">0.00</cbc:PrepaidAmount>',
    );
  });

  it('BT-115: PayableAmount = TaxInclusiveAmount − PrepaidAmount', () => {
    // prepaid=0 so PayableAmount == payableAmount
    expect(xml).toContain(
      '<cbc:PayableAmount currencyID="EUR">1694.00</cbc:PayableAmount>',
    );
  });

  it('PayableAmount adjusts when prepaidAmount is non-zero', () => {
    const out = builder.build({ ...BASE_INPUT, prepaidAmount: 200 });
    expect(out).toContain(
      '<cbc:PrepaidAmount currencyID="EUR">200.00</cbc:PrepaidAmount>',
    );
    expect(out).toContain(
      '<cbc:PayableAmount currencyID="EUR">1494.00</cbc:PayableAmount>',
    );
  });

  // ── BG-23 VAT breakdown ───────────────────────────────────────────────────

  it('BG-23: TaxSubtotal is present', () => {
    expect(xml).toContain('<cac:TaxSubtotal>');
  });

  it('BT-116: TaxableAmount in TaxSubtotal', () => {
    expect(xml).toContain(
      '<cbc:TaxableAmount currencyID="EUR">1400.00</cbc:TaxableAmount>',
    );
  });

  it('BT-117: TaxAmount in TaxSubtotal', () => {
    // Second occurrence of TaxAmount (first is the total in TaxTotal)
    const occurrences = xml.match(/<cbc:TaxAmount currencyID="EUR">294\.00<\/cbc:TaxAmount>/g);
    expect(occurrences).toHaveLength(2); // once in TaxTotal, once in TaxSubtotal
  });

  it('BT-119: Percent in TaxCategory', () => {
    expect(xml).toContain('<cbc:Percent>21</cbc:Percent>');
  });

  it('BT-118: VAT category code S in TaxCategory', () => {
    expect(xml).toContain('<cbc:ID>S</cbc:ID>');
  });

  // ── BG-25 Invoice lines ───────────────────────────────────────────────────

  it('renders 2 InvoiceLine elements', () => {
    const matches = xml.match(/<cac:InvoiceLine>/g);
    expect(matches).toHaveLength(2);
  });

  it('BT-153: item descriptions present', () => {
    expect(xml).toContain('Consulting services');
    expect(xml).toContain('Project management');
  });

  it('BT-131: LineExtensionAmount on line 1 = 1000.00', () => {
    // line-level LineExtensionAmount
    expect(xml).toContain(
      '<cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>',
    );
  });

  it('BT-146: PriceAmount on line 1 = 100', () => {
    expect(xml).toContain('<cbc:PriceAmount currencyID="EUR">100</cbc:PriceAmount>');
  });

  it('BT-130: InvoicedQuantity with unit code HUR', () => {
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="HUR">10</cbc:InvoicedQuantity>');
  });
});
