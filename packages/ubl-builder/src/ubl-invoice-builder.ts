import { create } from 'xmlbuilder2';
import type { TaxCategoryCode } from '@invoice/shared-types';

export interface UblParty {
  name: string;
  registrationNumber?: string;
  vatNumber?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country: string;
  email?: string;
  iban?: string;
  bic?: string;
}

export interface UblLine {
  id: number;
  description: string;
  quantity: number;
  unitCode: string;
  unitPrice: number;
  lineExtensionAmount: number;
  taxCategoryCode: TaxCategoryCode;
  taxPercent: number;
  taxAmount: number;
  allowancePercent?: number;
}

export interface UblInvoiceInput {
  customizationId?: string;
  profileId?: string;
  invoiceNumber: string;
  /** UBL invoice type code: 380=invoice, 381=credit note, 383=debit note */
  typeCode: '380' | '381' | '383';
  issueDate: string;        // YYYY-MM-DD
  dueDate?: string;
  currencyCode: string;
  buyerReference?: string;
  orderReference?: string;
  note?: string;
  seller: UblParty;
  buyer: UblParty;
  lines: UblLine[];
  /** BT-110 Total VAT amount */
  taxAmount: number;
  /** BT-106 / BT-109 Sum of line net amounts (before VAT) */
  taxableAmount: number;
  /** BT-112 Total amount with VAT */
  payableAmount: number;
  /** BT-107 Sum of document-level allowances (default 0) */
  allowancesTotalAmount?: number;
  /** BT-108 Sum of document-level charges (default 0) */
  chargeTotalAmount?: number;
  /** BT-113 Prepaid / already-paid amount (default 0) */
  prepaidAmount?: number;
}

const PEPPOL_CUSTOMIZATION =
  'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
const PEPPOL_PROFILE = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

export class UblInvoiceBuilder {
  build(input: UblInvoiceInput): string {
    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('Invoice', {
      xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    });

    root.ele('cbc:CustomizationID').txt(input.customizationId ?? PEPPOL_CUSTOMIZATION);
    root.ele('cbc:ProfileID').txt(input.profileId ?? PEPPOL_PROFILE);
    root.ele('cbc:ID').txt(input.invoiceNumber);
    root.ele('cbc:IssueDate').txt(input.issueDate);
    if (input.dueDate) root.ele('cbc:DueDate').txt(input.dueDate);
    root.ele('cbc:InvoiceTypeCode').txt(input.typeCode);
    if (input.note) root.ele('cbc:Note').txt(input.note);
    root.ele('cbc:DocumentCurrencyCode').txt(input.currencyCode);
    if (input.buyerReference) root.ele('cbc:BuyerReference').txt(input.buyerReference);
    if (input.orderReference) {
      root.ele('cac:OrderReference').ele('cbc:ID').txt(input.orderReference);
    }

    this.party(root, 'cac:AccountingSupplierParty', input.seller);
    this.party(root, 'cac:AccountingCustomerParty', input.buyer);

    if (input.seller.iban) {
      root.ele('cac:PaymentMeans')
        .ele('cbc:PaymentMeansCode').txt('30').up()
        .ele('cac:PayeeFinancialAccount')
        .ele('cbc:ID').txt(input.seller.iban).up()
        .ele('cac:FinancialInstitutionBranch')
        .ele('cbc:ID').txt(input.seller.bic ?? '');
    }

    // Tax total — grouped by category
    const taxGroups = this.groupByCategory(input.lines);
    const tt = root.ele('cac:TaxTotal');
    tt.ele('cbc:TaxAmount', { currencyID: input.currencyCode }).txt(f2(input.taxAmount));
    for (const [key, lines] of Object.entries(taxGroups)) {
      const [cat, pct] = key.split('_') as [TaxCategoryCode, string];
      const base = lines.reduce((s, l) => s + l.lineExtensionAmount, 0);
      const tax  = lines.reduce((s, l) => s + l.taxAmount, 0);
      const ts = tt.ele('cac:TaxSubtotal');
      ts.ele('cbc:TaxableAmount', { currencyID: input.currencyCode }).txt(f2(base));
      ts.ele('cbc:TaxAmount', { currencyID: input.currencyCode }).txt(f2(tax));
      ts.ele('cac:TaxCategory')
        .ele('cbc:ID').txt(cat).up()
        .ele('cbc:Percent').txt(pct).up()
        .ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
    }

    // BG-22 Monetary totals — all 6 EN 16931 monetary BT fields
    const allowances  = input.allowancesTotalAmount ?? 0;
    const charges     = input.chargeTotalAmount    ?? 0;
    const prepaid     = input.prepaidAmount        ?? 0;
    // BT-109 = BT-106 − BT-107 + BT-108  (no doc-level allowances/charges → same as taxableAmount)
    const taxExclusive = input.taxableAmount - allowances + charges;
    // BT-115 = BT-112 − BT-113 (amount still to be paid after any prepayment)
    const payable      = input.payableAmount - prepaid;

    const lma = root.ele('cac:LegalMonetaryTotal');
    // BT-106 Sum of line net amounts
    lma.ele('cbc:LineExtensionAmount',    { currencyID: input.currencyCode }).txt(f2(input.taxableAmount));
    // BT-107 Sum of document-level allowances (omit when zero — keep XML lean)
    if (allowances > 0)
      lma.ele('cbc:AllowancesTotalAmount', { currencyID: input.currencyCode }).txt(f2(allowances));
    // BT-108 Sum of document-level charges (omit when zero)
    if (charges > 0)
      lma.ele('cbc:ChargeTotalAmount',    { currencyID: input.currencyCode }).txt(f2(charges));
    // BT-109 Invoice total without VAT
    lma.ele('cbc:TaxExclusiveAmount',     { currencyID: input.currencyCode }).txt(f2(taxExclusive));
    // BT-112 Invoice total with VAT
    lma.ele('cbc:TaxInclusiveAmount',     { currencyID: input.currencyCode }).txt(f2(input.payableAmount));
    // BT-113 Amount already paid (always emit so validators see explicit 0.00)
    lma.ele('cbc:PrepaidAmount',          { currencyID: input.currencyCode }).txt(f2(prepaid));
    // BT-115 Amount due for payment
    lma.ele('cbc:PayableAmount',          { currencyID: input.currencyCode }).txt(f2(payable));

    // Invoice lines
    for (const line of input.lines) {
      const il = root.ele('cac:InvoiceLine');
      il.ele('cbc:ID').txt(String(line.id));
      il.ele('cbc:InvoicedQuantity', { unitCode: line.unitCode }).txt(String(line.quantity));
      il.ele('cbc:LineExtensionAmount', { currencyID: input.currencyCode }).txt(f2(line.lineExtensionAmount));
      il.ele('cac:Item')
        .ele('cbc:Description').txt(line.description).up()
        .ele('cbc:Name').txt(line.description).up()
        .ele('cac:ClassifiedTaxCategory')
        .ele('cbc:ID').txt(line.taxCategoryCode).up()
        .ele('cbc:Percent').txt(String(line.taxPercent)).up()
        .ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
      const price = il.ele('cac:Price');
      price.ele('cbc:PriceAmount', { currencyID: input.currencyCode }).txt(String(line.unitPrice));
      if (line.allowancePercent) {
        price.ele('cac:AllowanceCharge')
          .ele('cbc:ChargeIndicator').txt('false').up()
          .ele('cbc:Amount', { currencyID: input.currencyCode })
          .txt(f2(line.unitPrice * (line.allowancePercent / 100)));
      }
    }

    return root.end({ prettyPrint: true });
  }

  private party(parent: ReturnType<typeof create>, tag: string, p: UblParty) {
    const w = parent.ele(tag).ele('cac:Party');
    if (p.vatNumber) {
      w.ele('cac:PartyTaxScheme')
        .ele('cbc:CompanyID').txt(p.vatNumber).up()
        .ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
    }
    w.ele('cac:PartyLegalEntity')
      .ele('cbc:RegistrationName').txt(p.name).up()
      .ele('cbc:CompanyID').txt(p.registrationNumber ?? '');
    const addr = w.ele('cac:PostalAddress');
    if (p.street)     addr.ele('cbc:StreetName').txt(p.street);
    if (p.city)       addr.ele('cbc:CityName').txt(p.city);
    if (p.postalCode) addr.ele('cbc:PostalZone').txt(p.postalCode);
    addr.ele('cac:Country').ele('cbc:IdentificationCode').txt(p.country);
    if (p.email) w.ele('cac:Contact').ele('cbc:ElectronicMail').txt(p.email);
  }

  private groupByCategory(lines: UblLine[]): Record<string, UblLine[]> {
    const g: Record<string, UblLine[]> = {};
    for (const l of lines) {
      const k = `${l.taxCategoryCode}_${l.taxPercent}`;
      (g[k] ??= []).push(l);
    }
    return g;
  }
}

function f2(n: number): string { return n.toFixed(2); }
