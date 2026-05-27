import { create } from 'xmlbuilder2';
import type { RenderInput, RenderLine } from '../types';

/**
 * Generates EN 16931 / PEPPOL BIS Billing 3.0 UBL 2.1 XML.
 * The output can be embedded into a PDF/A-3 attachment (ZUGFeRD/Factur-X style)
 * or sent standalone via PEPPOL AS4.
 */
export class UblRenderer {
  render(input: RenderInput): string {
    const typeCode = this.resolveTypeCode(input.invoiceType);
    const now = new Date().toISOString();

    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Invoice', {
        xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
        'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
      });

    // BT-1 Invoice number, BT-2 Issue date, BT-9 Due date
    root.ele('cbc:CustomizationID').txt(
      'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    );
    root.ele('cbc:ProfileID').txt('urn:fdc:peppol.eu:2017:poacc:billing:01:1.0');
    root.ele('cbc:ID').txt(input.invoiceNumber);
    root.ele('cbc:IssueDate').txt(fmt(input.issuedAt));
    root.ele('cbc:DueDate').txt(fmt(input.dueAt));
    root.ele('cbc:InvoiceTypeCode').txt(typeCode);
    if (input.note) root.ele('cbc:Note').txt(input.note);
    root.ele('cbc:DocumentCurrencyCode').txt(input.currencyCode);
    if (input.buyerReference) root.ele('cbc:BuyerReference').txt(input.buyerReference);
    if (input.orderReference) {
      root.ele('cac:OrderReference').ele('cbc:ID').txt(input.orderReference);
    }

    // BG-4 Seller
    this.addParty(root, 'cac:AccountingSupplierParty', input.seller, input.currencyCode);
    // BG-7 Buyer
    this.addParty(root, 'cac:AccountingCustomerParty', input.buyer, input.currencyCode);

    // BG-16 Payment means
    if (input.seller.iban) {
      const pm = root.ele('cac:PaymentMeans');
      pm.ele('cbc:PaymentMeansCode').txt('30'); // 30 = credit transfer
      pm.ele('cac:PayeeFinancialAccount')
        .ele('cbc:ID').txt(input.seller.iban).up()
        .ele('cac:FinancialInstitutionBranch')
        .ele('cbc:ID').txt(input.seller.bic ?? '');
    }

    // BG-23 Tax total
    const taxTotal = root.ele('cac:TaxTotal');
    taxTotal.ele('cbc:TaxAmount', { currencyID: input.currencyCode })
      .txt(dp2(input.taxAmount));

    // Group lines by tax category for sub-totals
    const taxGroups = groupByTax(input.lines);
    for (const [key, lines] of Object.entries(taxGroups)) {
      const [categoryCode, rateStr] = key.split('_') as [string, string];
      const groupTax = lines.reduce((s, l) => s + l.taxAmount, 0);
      const groupBase = lines.reduce((s, l) => s + l.lineTotal, 0);
      const ts = taxTotal.ele('cac:TaxSubtotal');
      ts.ele('cbc:TaxableAmount', { currencyID: input.currencyCode }).txt(dp2(groupBase));
      ts.ele('cbc:TaxAmount', { currencyID: input.currencyCode }).txt(dp2(groupTax));
      const tc = ts.ele('cac:TaxCategory');
      tc.ele('cbc:ID').txt(categoryCode);
      tc.ele('cbc:Percent').txt(rateStr);
      tc.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
    }

    // BG-22 Document totals
    const lma = root.ele('cac:LegalMonetaryTotal');
    lma.ele('cbc:LineExtensionAmount', { currencyID: input.currencyCode }).txt(dp2(input.subtotal));
    lma.ele('cbc:TaxExclusiveAmount', { currencyID: input.currencyCode }).txt(dp2(input.subtotal));
    lma.ele('cbc:TaxInclusiveAmount', { currencyID: input.currencyCode }).txt(dp2(input.total));
    lma.ele('cbc:PayableAmount', { currencyID: input.currencyCode }).txt(dp2(input.total));

    // BG-25 Invoice lines
    for (const line of input.lines) {
      this.addLine(root, line, input.currencyCode);
    }

    return root.end({ prettyPrint: true });
  }

  private addParty(
    parent: ReturnType<typeof create>,
    tagName: string,
    party: RenderInput['seller'],
    _currency: string,
  ) {
    const wrapper = parent.ele(tagName);
    const p = wrapper.ele('cac:Party');

    if (party.vatNumber) {
      p.ele('cac:PartyTaxScheme')
        .ele('cbc:CompanyID').txt(party.vatNumber).up()
        .ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
    }

    p.ele('cac:PartyLegalEntity')
      .ele('cbc:RegistrationName').txt(party.name).up()
      .ele('cbc:CompanyID').txt(party.registrationNumber ?? '');

    const addr = p.ele('cac:PostalAddress');
    if (party.street)     addr.ele('cbc:StreetName').txt(party.street);
    if (party.city)       addr.ele('cbc:CityName').txt(party.city);
    if (party.postalCode) addr.ele('cbc:PostalZone').txt(party.postalCode);
    addr.ele('cac:Country').ele('cbc:IdentificationCode').txt(party.country);

    if (party.email) {
      p.ele('cac:Contact').ele('cbc:ElectronicMail').txt(party.email);
    }
  }

  private addLine(
    parent: ReturnType<typeof create>,
    line: RenderLine,
    currency: string,
  ) {
    const il = parent.ele('cac:InvoiceLine');
    il.ele('cbc:ID').txt(String(line.lineNumber));
    il.ele('cbc:InvoicedQuantity', { unitCode: line.unit }).txt(String(line.quantity));
    il.ele('cbc:LineExtensionAmount', { currencyID: currency }).txt(dp2(line.lineTotal));

    const item = il.ele('cac:Item');
    item.ele('cbc:Description').txt(line.description);
    item.ele('cbc:Name').txt(line.description);
    const ctc = item.ele('cac:ClassifiedTaxCategory');
    ctc.ele('cbc:ID').txt(line.taxCategoryCode);
    ctc.ele('cbc:Percent').txt(dp2(line.taxRate * 100));
    ctc.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');

    const price = il.ele('cac:Price');
    price.ele('cbc:PriceAmount', { currencyID: currency }).txt(String(line.unitPrice));
    if (line.discount) {
      price.ele('cac:AllowanceCharge')
        .ele('cbc:ChargeIndicator').txt('false').up()
        .ele('cbc:Amount', { currencyID: currency }).txt(dp2(line.unitPrice * line.discount));
    }
  }

  private resolveTypeCode(type: RenderInput['invoiceType']): string {
    switch (type) {
      case 'CREDIT_NOTE': return '381';
      case 'DEBIT_NOTE':  return '383';
      default:            return '380';
    }
  }
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dp2(n: number): string {
  return n.toFixed(2);
}

function groupByTax(lines: RenderLine[]): Record<string, RenderLine[]> {
  const groups: Record<string, RenderLine[]> = {};
  for (const l of lines) {
    const key = `${l.taxCategoryCode}_${(l.taxRate * 100).toFixed(2)}`;
    (groups[key] ??= []).push(l);
  }
  return groups;
}
