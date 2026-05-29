/**
 * InvoicePdfService
 *
 * Generates an A4 PDF for an invoice using pdf-lib.
 * Covers all EN 16931 mandatory BT fields visible in the document.
 *
 *  BT-1   Invoice number
 *  BT-2   Issue date
 *  BT-3   Invoice type (INVOICE)
 *  BT-5   Currency
 *  BT-9   Due date
 *  BT-20  Payment terms note
 *  BT-27  Seller name
 *  BT-28  Seller trading name
 *  BT-30  Seller legal registration ID (businessId)
 *  BT-31  Seller VAT number
 *  BT-35  Seller address
 *  BT-44  Buyer name
 *  BT-46  Buyer VAT number
 *  BT-50  Buyer address
 *  BT-84  Payment IBAN
 *  BT-85  Payment BIC
 *  BT-106 Sum of line extension amounts (subtotal)
 *  BT-110 Total VAT amount
 *  BT-112 Invoice total with VAT (grand total)
 *  BT-115 Amount due for payment
 *  BT-118 VAT category code (BG-23)
 *  BT-119 VAT rate (BG-23)
 *  BT-131 Line net amount
 *  BT-146 Item net unit price
 *  BT-152 Item VAT rate
 *  BT-153 Item name/description
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, BankAccount } from '@prisma/client';

// ── EPC QR code cache (keyed by IBAN) ────────────────────────────────────────
// The QR PNG generation is CPU-bound (~150ms/call). Cache per-IBAN so only
// the very first PDF for a given seller IBAN pays that cost; all subsequent
// PDFs reuse the pre-rendered buffer.

const qrCache = new Map<string, Buffer>();

// ── Prisma return type ────────────────────────────────────────────────────────

type InvoiceWithAll = Prisma.InvoiceGetPayload<{
  include: {
    buyer:           { include: { addresses: true } };
    seller:          { include: { addresses: true } };
    lines:           { include: { taxRate: true } };
    vatBreakdowns:   true;
    originalInvoice: true;
  };
}>;

// ── Page geometry (A4) ────────────────────────────────────────────────────────

const PW = 595.28;   // page width  (pt)
const PH = 841.89;   // page height (pt)
const ML = 50;       // left margin
const MR = 50;       // right margin
const CW = PW - ML - MR;  // 495.28 — usable content width

// ── Colour palette ────────────────────────────────────────────────────────────

const C = {
  accent:   rgb(0.173, 0.388, 0.671),   // #2c63ab
  accentLt: rgb(0.780, 0.875, 0.980),   // light accent for number in bar
  white:    rgb(1.000, 1.000, 1.000),
  dark:     rgb(0.102, 0.102, 0.118),   // near-black body text
  mid:      rgb(0.365, 0.365, 0.380),   // secondary text
  muted:    rgb(0.553, 0.553, 0.569),   // labels / captions
  rowAlt:   rgb(0.961, 0.961, 0.976),   // alternate table row
  totalBg:  rgb(0.929, 0.945, 0.980),   // totals box fill
  dueBg:    rgb(0.149, 0.388, 0.671),   // amount-due accent row (slightly darker)
  border:   rgb(0.780, 0.780, 0.800),   // rule / box borders
  badge:    rgb(0.310, 0.560, 0.820),   // status badge fill
};

// ── Line-items table column widths (must sum to CW = 495) ────────────────────
//  #    desc  qty   unit  price  net   vat%
// 20 + 168 + 42 +  38 +  75 +  78 +  74  = 495 ✓

const TC = { num: 20, desc: 168, qty: 42, unit: 38, price: 75, net: 78, vat: 74 };

// Cumulative left-edge x for each column (relative to ML)
const TX = {
  num:   0,
  desc:  TC.num,
  qty:   TC.num + TC.desc,
  unit:  TC.num + TC.desc + TC.qty,
  price: TC.num + TC.desc + TC.qty + TC.unit,
  net:   TC.num + TC.desc + TC.qty + TC.unit + TC.price,
  vat:   TC.num + TC.desc + TC.qty + TC.unit + TC.price + TC.net,
};

// ── Text helpers ──────────────────────────────────────────────────────────────

/**
 * Transcode text to WinAnsi-safe Latin-1.
 * pdf-lib standard fonts (Helvetica) use WinAnsiEncoding which covers
 * ISO 8859-1 (Ä Ö Ü ä ö ü and other Latin-1 Supplement chars) but NOT
 * Baltic/extended Latin chars like Ā Č Ē Š Ž.  We map them to ASCII
 * equivalents so the PDF renders without throwing.
 */
function safe(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  const MAP: Record<string, string> = {
    'Ā': 'A', 'ā': 'a', 'Ă': 'A', 'ă': 'a',
    'Č': 'C', 'č': 'c', 'Đ': 'D', 'đ': 'd',
    'Ē': 'E', 'ē': 'e', 'Ė': 'E', 'ė': 'e',
    'Ę': 'E', 'ę': 'e', 'Ě': 'E', 'ě': 'e',
    'Ģ': 'G', 'ģ': 'g', 'Ī': 'I', 'ī': 'i',
    'Į': 'I', 'į': 'i', 'Ķ': 'K', 'ķ': 'k',
    'Ļ': 'L', 'ļ': 'l', 'Ł': 'L', 'ł': 'l',
    'Ń': 'N', 'ń': 'n', 'Ņ': 'N', 'ņ': 'n',
    'Ň': 'N', 'ň': 'n', 'Š': 'S', 'š': 's',
    'Ş': 'S', 'ş': 's', 'Ţ': 'T', 'ţ': 't',
    'Ū': 'U', 'ū': 'u', 'Ų': 'U', 'ų': 'u',
    'Ž': 'Z', 'ž': 'z', 'Ż': 'Z', 'ż': 'z',
    '–': '-',  '—': '-',
    '‘': "'",  '’': "'",
    '“': '"',  '”': '"',
    '…': '...',
  };
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\xFF]/g, (c) => MAP[c] ?? '?')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

/** Format a number as a money string: 1234.5 → "1,234.50" */
function money(val: unknown): string {
  const n   = Number(val ?? 0);
  const [int, dec] = n.toFixed(2).split('.') as [string, string];
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec;
}

/** Format a Date or ISO string as "14 Nov 2024" */
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ── Low-level drawing helpers ─────────────────────────────────────────────────

/** Draw left-aligned text, truncating with ".." if it exceeds maxW */
function ltxt(
  p: PDFPage, text: string,
  x: number, y: number,
  font: PDFFont, size: number,
  color = C.dark, maxW?: number,
): void {
  let s = safe(text);
  if (maxW !== undefined) {
    while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxW) s = s.slice(0, -1);
    if (safe(text) !== s) s = s.slice(0, -1) + '..';
  }
  p.drawText(s, { x, y, font, size, color });
}

/** Draw right-aligned text, right edge at rightX */
function rtxt(
  p: PDFPage, text: string,
  rightX: number, y: number,
  font: PDFFont, size: number,
  color = C.dark,
): void {
  const s = safe(text);
  const w = font.widthOfTextAtSize(s, size);
  p.drawText(s, { x: rightX - w, y, font, size, color });
}

/** Draw a full-width horizontal rule */
function rule(
  p: PDFPage,
  y: number,
  x     = ML,
  width = CW,
  thick = 0.5,
  color = C.border,
): void {
  p.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: thick, color });
}

/** Draw a filled rectangle */
function rect(
  p: PDFPage,
  x: number, y: number, w: number, h: number,
  fill: ReturnType<typeof rgb>,
  borderColor?: ReturnType<typeof rgb>,
  borderWidth  = 0.5,
): void {
  p.drawRectangle({
    x, y, width: w, height: h,
    color: fill,
    ...(borderColor ? { borderColor, borderWidth } : {}),
  });
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Public entry-point ────────────────────────────────────────────────────

  async generate(
    tenantId: string,
    idOrNumber: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        tenantId,
        ...(isUuid ? { id: idOrNumber } : { number: idOrNumber }),
      },
      include: {
        buyer:           { include: { addresses: { orderBy: { isDefault: 'desc' } } } },
        seller:          { include: { addresses: { orderBy: { isDefault: 'desc' } } } },
        lines:           { include: { taxRate: true }, orderBy: { lineNumber: 'asc' } },
        vatBreakdowns:   { orderBy: { vatRatePercent: 'asc' } },
        originalInvoice: true,
      },
    });

    if (!invoice) throw new NotFoundException(`Invoice ${idOrNumber} not found`);

    const bank = await this.prisma.bankAccount.findFirst({
      where: { tenantId, isDefault: true },
    });

    this.logger.log(`Generating PDF for ${invoice.number}`);
    const buffer = await this.buildPdf(invoice, bank);
    return { buffer, filename: `${invoice.number}.pdf` };
  }

  // ── PDF builder ───────────────────────────────────────────────────────────

  private async buildPdf(
    inv: InvoiceWithAll,
    bank: BankAccount | null,
  ): Promise<Buffer> {
    const doc  = await PDFDocument.create();
    doc.setTitle(inv.number);
    doc.setAuthor(safe(inv.seller.name));
    doc.setSubject(`Invoice ${inv.number}`);
    doc.setCreationDate(new Date());

    const page = doc.addPage([PW, PH]);

    // Embed the two fonts we'll use throughout
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const reg  = await doc.embedFont(StandardFonts.Helvetica);

    // Work with a Y cursor measured from the TOP of the page.
    // pdf-lib uses y=0 at the bottom, so we convert with:  pdfY(t) = PH - t
    const pdfY = (fromTop: number) => PH - fromTop;

    // ── Section 1: Accent header bar ───────────────────────────────────────
    const isCreditNote = inv.type === 'CREDIT_NOTE';
    const BAR_H = isCreditNote ? 68 : 54;
    rect(page, 0, pdfY(BAR_H), PW, BAR_H, C.accent);

    // Document type wordmark
    const wordmark = isCreditNote ? 'CREDIT NOTE' : 'INVOICE';
    ltxt(page, wordmark, ML, pdfY(BAR_H - 16), bold, 21, C.white);

    // Document number in bar
    ltxt(page, `No. ${inv.number}`, ML + (isCreditNote ? 180 : 126), pdfY(BAR_H - 16), reg, 13, C.accentLt);

    // For credit notes, show "Credit note for INV-XXXX" as subtitle
    if (isCreditNote && inv.originalInvoice) {
      ltxt(page, `Credit note for ${inv.originalInvoice.number}`, ML, pdfY(BAR_H - 34), reg, 9.5, C.accentLt);
    }

    // Status badge (right side of bar)
    const badgeText = inv.status;
    const badgeW    = bold.widthOfTextAtSize(badgeText, 8) + 14;
    const badgeX    = PW - MR - badgeW;
    rect(page, badgeX - 2, pdfY(BAR_H - 22), badgeW, 18, C.badge);
    ltxt(page, badgeText, badgeX + 5, pdfY(BAR_H - 10), bold, 8, C.white);

    // ── Section 2: FROM block (left) + Invoice meta box (right) ────────────
    const sellerAddr = inv.seller.addresses[0];
    const buyerAddr  = inv.buyer.addresses[0];

    let sectionTop = BAR_H + 20;

    // -- "FROM" label --
    ltxt(page, 'FROM', ML, pdfY(sectionTop + 6), bold, 7, C.muted);
    sectionTop += 7;

    // Seller name (BT-27)
    ltxt(page, inv.seller.name, ML, pdfY(sectionTop + 12), bold, 11, C.dark, 210);
    sectionTop += 14;

    // Seller address lines (BT-35)
    const sellerLines: string[] = [];
    if (sellerAddr) {
      if (sellerAddr.street)     sellerLines.push(sellerAddr.street);
      const cityLine = [sellerAddr.postalCode, sellerAddr.city].filter(Boolean).join(' ');
      if (cityLine)              sellerLines.push(cityLine);
      if (sellerAddr.country)    sellerLines.push(sellerAddr.country);
    }
    // Seller VAT (BT-31) and Reg (BT-30)
    if (inv.seller.vatNumber)    sellerLines.push(`VAT: ${inv.seller.vatNumber}`);
    if (inv.seller.businessId)   sellerLines.push(`Reg: ${inv.seller.businessId}`);

    for (const line of sellerLines) {
      ltxt(page, line, ML, pdfY(sectionTop + 10), reg, 9, C.mid, 210);
      sectionTop += 12;
    }

    // -- Invoice meta box (BT-1, BT-2, BT-9, BT-5) --
    const META_X  = ML + 300;
    const META_W  = CW - 300;        // 195 pt
    const META_TOP = BAR_H + 20;
    const metaRows: Array<[string, string]> = [
      ['Invoice No (BT-1):',  inv.number],
      ['Issue Date (BT-2):',  fmtDate(inv.issuedAt)],
      ['Due Date (BT-9):',    fmtDate(inv.dueAt)],
      ['Currency (BT-5):',    inv.currencyCode],
      ['Language:',           inv.language ?? 'en'],
      ['Type (BT-3):',        inv.type],
    ];
    const META_ROW_H = 16;
    const META_H     = metaRows.length * META_ROW_H + 12;
    rect(page,
      META_X - 6,
      pdfY(META_TOP + META_H - 6),
      META_W + 6,
      META_H,
      C.rowAlt,
      C.border,
    );

    let metaY = META_TOP + 8;
    for (const [label, value] of metaRows) {
      ltxt(page, label, META_X,       pdfY(metaY + 9), bold, 7.5, C.muted, 88);
      ltxt(page, value, META_X + 92,  pdfY(metaY + 9), reg,  7.5, C.dark,  META_W - 92);
      metaY += META_ROW_H;
    }

    // ── Section 3: Separator + BILL TO ─────────────────────────────────────
    let curY = Math.max(sectionTop, META_TOP + META_H + 4) + 8;

    rule(page, pdfY(curY));
    curY += 14;

    ltxt(page, 'BILL TO', ML, pdfY(curY + 6), bold, 7, C.muted);
    curY += 7;

    // Buyer name (BT-44)
    ltxt(page, inv.buyer.name, ML, pdfY(curY + 12), bold, 11, C.dark, CW * 0.55);
    curY += 14;

    // Buyer address (BT-50)
    const buyerLines: string[] = [];
    if (buyerAddr) {
      if (buyerAddr.street)   buyerLines.push(buyerAddr.street);
      const city = [buyerAddr.postalCode, buyerAddr.city].filter(Boolean).join(' ');
      if (city)               buyerLines.push(city);
      if (buyerAddr.country)  buyerLines.push(buyerAddr.country);
    }
    if (inv.buyer.vatNumber)  buyerLines.push(`VAT (BT-46): ${inv.buyer.vatNumber}`);
    if (inv.buyer.email)      buyerLines.push(inv.buyer.email);

    for (const line of buyerLines) {
      ltxt(page, line, ML, pdfY(curY + 10), reg, 9, C.mid, CW * 0.55);
      curY += 12;
    }

    curY += 14;

    // ── Section 4: Line-items table ─────────────────────────────────────────

    // Header bar
    const TH_H = 22;
    rect(page, ML, pdfY(curY + TH_H), CW, TH_H, C.accent);

    // Column headers (right-aligned for numeric cols)
    ltxt(page, '#',          ML + TX.num   + 3, pdfY(curY + TH_H - 8), bold, 8, C.white);
    ltxt(page, 'Description (BT-153)', ML + TX.desc + 3, pdfY(curY + TH_H - 8), bold, 8, C.white, TC.desc - 4);
    rtxt(page, 'Qty (BT-129)',     ML + TX.qty   + TC.qty  - 2, pdfY(curY + TH_H - 8), bold, 8, C.white);
    ltxt(page, 'Unit',         ML + TX.unit  + 3, pdfY(curY + TH_H - 8), bold, 8, C.white);
    rtxt(page, 'Unit Price (BT-146)', ML + TX.price + TC.price - 2, pdfY(curY + TH_H - 8), bold, 7, C.white);
    rtxt(page, 'Net Amt (BT-131)',    ML + TX.net   + TC.net   - 2, pdfY(curY + TH_H - 8), bold, 7, C.white);
    rtxt(page, 'VAT%',         ML + TX.vat   + TC.vat   - 2, pdfY(curY + TH_H - 8), bold, 8, C.white);

    curY += TH_H;

    // Rows
    const ROW_H = 19;
    for (let i = 0; i < inv.lines.length; i++) {
      const ln = inv.lines[i]!;
      const ty = pdfY(curY + ROW_H - 6);  // text baseline

      if (i % 2 === 1) {
        rect(page, ML, pdfY(curY + ROW_H), CW, ROW_H, C.rowAlt);
      }

      const qtyStr   = Number(ln.quantity).toLocaleString('en');
      const priceStr = money(ln.unitPrice);
      const netStr   = money(ln.lineTotal);
      const taxRate  = Number(ln.taxRate?.rate ?? 0);
      const vatStr   = taxRate === 0 ? '0%' : `${Math.round(taxRate * 100)}%`;

      ltxt(page, String(ln.lineNumber), ML + TX.num  + 3,                    ty, reg, 8.5, C.muted);
      ltxt(page, ln.description,        ML + TX.desc + 3,                    ty, reg, 8.5, C.dark,  TC.desc - 6);
      rtxt(page, qtyStr,                ML + TX.qty  + TC.qty  - 2,          ty, reg, 8.5);
      ltxt(page, safe(ln.unit ?? ''),   ML + TX.unit + 3,                    ty, reg, 8.5, C.mid);
      rtxt(page, priceStr,              ML + TX.price + TC.price - 2,        ty, reg, 8.5);
      rtxt(page, netStr,                ML + TX.net   + TC.net   - 2,        ty, bold, 8.5);
      rtxt(page, vatStr,                ML + TX.vat   + TC.vat   - 2,        ty, reg, 8.5, C.mid);

      curY += ROW_H;
    }

    rule(page, pdfY(curY), ML, CW);
    curY += 16;

    // ── Section 5: VAT breakdown (BG-23) ────────────────────────────────────

    ltxt(page, 'VAT BREAKDOWN  (EN 16931 BG-23)', ML, pdfY(curY + 9), bold, 9, C.accent);
    curY += 16;

    // VAT table col widths: rate=80, taxable=130, vat=130  total=340
    const VW = { rate: 80, taxable: 130, vat: 130 };
    const VH = 18;

    // Header row
    rect(page, ML, pdfY(curY + VH), VW.rate + VW.taxable + VW.vat, VH, C.rowAlt, C.border);
    ltxt(page, 'Rate (BT-119)',           ML + 3,                                   pdfY(curY + VH - 6), bold, 8, C.mid);
    rtxt(page, 'Taxable Amt (BT-116)',    ML + VW.rate + VW.taxable - 3,            pdfY(curY + VH - 6), bold, 8, C.mid);
    rtxt(page, 'VAT Amount (BT-117)',     ML + VW.rate + VW.taxable + VW.vat - 3,  pdfY(curY + VH - 6), bold, 8, C.mid);
    curY += VH;

    for (let i = 0; i < inv.vatBreakdowns.length; i++) {
      const vb = inv.vatBreakdowns[i]!;
      if (i % 2 === 0) {
        rect(page, ML, pdfY(curY + VH), VW.rate + VW.taxable + VW.vat, VH, C.rowAlt);
      }
      const rateStr = `${Number(vb.vatRatePercent)}%  (${vb.vatCategoryCode})`;
      ltxt(page, rateStr,                   ML + 3,                                  pdfY(curY + VH - 6), reg, 8.5);
      rtxt(page, money(vb.taxableAmount),   ML + VW.rate + VW.taxable - 3,           pdfY(curY + VH - 6), reg, 8.5);
      rtxt(page, money(vb.taxAmount),       ML + VW.rate + VW.taxable + VW.vat - 3, pdfY(curY + VH - 6), bold, 8.5);
      curY += VH;
    }

    curY += 18;

    // ── Section 6: Totals box ─────────────────────────────────────────────────

    const TOT_X  = ML + CW - 248;   // right-aligned, 248 wide
    const TOT_RX = ML + CW;
    const totRows: Array<{ label: string; value: string; bold?: boolean; highlight?: boolean }> = [
      { label: `Subtotal (BT-106):`,     value: `${money(inv.subtotal)} ${inv.currencyCode}` },
      { label: `Total VAT (BT-110):`,    value: `${money(inv.taxAmount)} ${inv.currencyCode}` },
      { label: `Grand Total (BT-112):`,  value: `${money(inv.total)} ${inv.currencyCode}`, bold: true },
      { label: `Amount Due (BT-115):`,   value: `${money(inv.total)} ${inv.currencyCode}`, bold: true, highlight: true },
    ];
    const TOT_ROW_H = 19;
    const TOT_H     = totRows.length * TOT_ROW_H + 10;

    rect(page, TOT_X - 6, pdfY(curY + TOT_H), 254, TOT_H, C.totalBg, C.border);

    let totY = curY + 8;
    for (let i = 0; i < totRows.length; i++) {
      const row = totRows[i]!;

      if (row.highlight) {
        rect(page, TOT_X - 6, pdfY(totY + TOT_ROW_H + 2), 254, TOT_ROW_H + 2, C.accent);
        const lc = C.accentLt;
        const vc = C.white;
        ltxt(page, row.label, TOT_X,   pdfY(totY + TOT_ROW_H - 5), bold, 9.5, lc);
        rtxt(page, row.value, TOT_RX,  pdfY(totY + TOT_ROW_H - 5), bold, 10.5, vc);
      } else {
        // Divider before "Grand Total" row
        if (row.bold && !row.highlight) {
          rule(page, pdfY(totY + 3), TOT_X - 6, 254, 0.5, C.border);
        }
        const f = row.bold ? bold : reg;
        const c = row.bold ? C.dark : C.mid;
        ltxt(page, row.label, TOT_X,   pdfY(totY + TOT_ROW_H - 5), f, row.bold ? 9.5 : 9, c);
        rtxt(page, row.value, TOT_RX,  pdfY(totY + TOT_ROW_H - 5), f, row.bold ? 9.5 : 9, C.dark);
      }
      totY += TOT_ROW_H;
    }

    // ── Section 6b: SEPA EPC QR code (only when seller IBAN is known) ──────────

    if (bank?.iban) {
      const epcContent = [
        'BCD',
        '002',
        '1',
        'SCT',
        bank.bic ?? '',
        inv.seller.name,
        bank.iban,
        `EUR${Number(inv.total).toFixed(2)}`,
        '',
        '',
        inv.number,
        '',
      ].join('\n');

      try {
        const cached = qrCache.get(bank.iban);
        const qrPng  = cached ?? await QRCode.toBuffer(epcContent, { type: 'png', width: 150, margin: 1 });
        if (!cached) qrCache.set(bank.iban, qrPng);
        const qrImage = await doc.embedPng(qrPng);

        const QR_SIZE  = 80;    // display size in PDF points
        const qrLeft   = TOT_RX - QR_SIZE;
        const qrFromTop = curY + TOT_H + 10;
        const qrPdfY   = pdfY(qrFromTop + QR_SIZE);  // bottom-left in pdf-lib coords

        doc.setSubject(`Invoice ${inv.number}`);  // keep metadata intact
        page.drawImage(qrImage, { x: qrLeft, y: qrPdfY, width: QR_SIZE, height: QR_SIZE });

        // Label below QR code
        const labelText = 'Scan to pay (SEPA)';
        const labelSize = 7;
        const labelW    = reg.widthOfTextAtSize(labelText, labelSize);
        const labelX    = qrLeft + (QR_SIZE - labelW) / 2;
        page.drawText(labelText, {
          x: labelX,
          y: qrPdfY - 10,
          font: reg,
          size: labelSize,
          color: C.muted,
        });
      } catch (err) {
        this.logger.warn(`QR code generation failed (non-fatal): ${(err as Error).message}`);
      }
    }

    // ── Section 7: Footer ─────────────────────────────────────────────────────
    // FOOTER_Y is a raw pdf-lib y coordinate (from bottom, NOT through pdfY).
    // 55pt from the bottom = about 1.9 cm above the page edge.
    const FOOTER_Y = 55;

    rule(page, FOOTER_Y);

    let footerLeft  = FOOTER_Y - 14;
    const footerRight = FOOTER_Y - 14;

    // Payment terms (BT-20)
    if (inv.paymentTermsNote) {
      ltxt(page, `Payment Terms (BT-20): ${inv.paymentTermsNote}`,
        ML, footerLeft, bold, 8, C.mid);
      footerLeft -= 12;
    }

    // Bank account (BT-84 IBAN, BT-85 BIC)
    if (bank) {
      const bankParts = [
        bank.iban     ? `IBAN (BT-84): ${bank.iban}` : null,
        bank.bic      ? `BIC (BT-85): ${bank.bic}` : null,
        bank.bankName ? `Bank: ${bank.bankName}` : null,
      ].filter(Boolean).join('   ');

      if (bankParts) {
        ltxt(page, bankParts, ML, footerLeft, reg, 8, C.mid, CW * 0.8);
        footerLeft -= 12;
      }
    }

    // Right: generated date
    const genLine = `Generated: ${new Date().toISOString().slice(0, 10)}`;
    rtxt(page, genLine, TOT_RX, footerRight, reg, 7.5, C.muted);

    // Right: note
    const noteLine = 'EN 16931 compliant';
    rtxt(page, noteLine, TOT_RX, footerRight - 11, reg, 7.5, C.muted);

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }
}
