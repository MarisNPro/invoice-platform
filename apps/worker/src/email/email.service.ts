import 'dotenv/config';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { Logger } from '../logger';
import { prisma } from '../prisma';

// ── Config ────────────────────────────────────────────────────────────────────

const EMAIL_PROVIDER = process.env['EMAIL_PROVIDER'] ?? 'mailhog';
const SMTP_HOST      = process.env['SMTP_HOST']      ?? 'localhost';
const SMTP_PORT      = Number(process.env['SMTP_PORT'] ?? 1025);
const RESEND_API_KEY = process.env['RESEND_API_KEY'] ?? '';
const EMAIL_FROM     = process.env['EMAIL_FROM']     ?? 'invoices@invoiceplatform.local';
const APP_BASE_URL   = process.env['APP_BASE_URL']   ?? 'http://localhost:4000';
const NODE_ENV       = process.env['NODE_ENV']        ?? 'development';

const logger = new Logger('EmailService');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SendInvoiceParams {
  invoiceId:      string;
  recipientEmail: string;
  language:       string;
  tenantId:       string;
  transmissionId: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class EmailService {
  async sendInvoice(params: SendInvoiceParams): Promise<{ messageId: string }> {
    const { invoiceId, recipientEmail, tenantId, transmissionId } = params;

    // 1. Load full invoice from DB
    const invoice = await prisma.invoice.findUnique({
      where:   { id: invoiceId },
      include: {
        seller:        { include: { addresses: { where: { isDefault: true }, take: 1 } } },
        buyer:         { include: { addresses: { where: { isDefault: true }, take: 1 } } },
        lines:         { include: { taxRate: true }, orderBy: { lineNumber: 'asc' } },
        vatBreakdowns: { orderBy: { vatRatePercent: 'asc' } },
      },
    });

    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

    // 2. Fetch PDF from API
    const authHeaders =
      NODE_ENV !== 'production'
        ? { 'x-dev-tenant-id': tenantId }
        : { Authorization: `Bearer ${process.env['WORKER_SERVICE_TOKEN'] ?? ''}` };

    const [pdfRes, ublRes] = await Promise.all([
      axios.get<ArrayBuffer>(`${APP_BASE_URL}/api/v1/invoices/${invoiceId}/pdf`, {
        responseType: 'arraybuffer',
        headers: authHeaders,
      }),
      // 3. Fetch UBL XML from API
      axios.get<string>(`${APP_BASE_URL}/api/v1/invoices/${invoiceId}/ubl`, {
        responseType: 'text',
        headers: authHeaders,
      }),
    ]);

    const pdfBuffer = Buffer.from(pdfRes.data);
    const ublXml    = ublRes.data;

    // 4. Build HTML email
    const html = buildEmailHtml({
      invoiceNumber: invoice.number,
      issueDate:     invoice.issuedAt,
      dueDate:       invoice.dueAt,
      currency:      invoice.currencyCode,
      total:         Number(invoice.total),
      subtotal:      Number(invoice.subtotal),
      taxAmount:     Number(invoice.taxAmount),
      buyerName:     invoice.buyer.name,
      sellerName:    invoice.seller.name,
      sellerIban:    invoice.seller.iban,
      sellerEmail:   invoice.seller.email ?? EMAIL_FROM,
      note:          invoice.note,
      lines: invoice.lines.map((l) => ({
        description: l.description,
        quantity:    Number(l.quantity),
        unit:        l.unit,
        unitPrice:   Number(l.unitPrice),
        lineTotal:   Number(l.lineTotal),
        taxRate:     l.taxRate ? Math.round(Number(l.taxRate.rate) * 10000) / 100 : 0,
      })),
    });

    // 5. Send via Resend or nodemailer (MailHog)
    const subject = `Invoice ${invoice.number} from ${invoice.seller.name} — ${Number(invoice.total).toFixed(2)} ${invoice.currencyCode}`;
    const pdfFilename = `invoice-${invoice.number}.pdf`;
    const xmlFilename = `invoice-${invoice.number}.xml`;

    let messageId: string;

    if (EMAIL_PROVIDER === 'resend') {
      const resend = new Resend(RESEND_API_KEY);
      const { data, error } = await resend.emails.send({
        from:        EMAIL_FROM,
        to:          [recipientEmail],
        replyTo:     invoice.seller.email ?? undefined,
        subject,
        html,
        attachments: [
          { filename: pdfFilename, content: pdfBuffer.toString('base64') },
          { filename: xmlFilename, content: Buffer.from(ublXml, 'utf8').toString('base64') },
        ],
      });
      if (error || !data) throw new Error(`Resend: ${error?.message ?? 'no data returned'}`);
      messageId = data.id;
    } else {
      // MailHog / generic SMTP
      const transporter = nodemailer.createTransport({
        host:   SMTP_HOST,
        port:   SMTP_PORT,
        secure: false,
      });
      const info = await transporter.sendMail({
        from:       EMAIL_FROM,
        to:         recipientEmail,
        replyTo:    invoice.seller.email ?? undefined,
        subject,
        html,
        attachments: [
          { filename: pdfFilename, content: pdfBuffer,              contentType: 'application/pdf' },
          { filename: xmlFilename, content: Buffer.from(ublXml, 'utf8'), contentType: 'application/xml' },
        ],
      });
      messageId = String(info.messageId);
    }

    logger.log(
      `Invoice ${invoice.number} sent to ${recipientEmail} via ${EMAIL_PROVIDER} (msgId=${messageId})`,
    );

    // 6. Update invoice status → SENT
    await prisma.invoice.update({
      where: { id: invoiceId },
      data:  { status: 'SENT' },
    });

    // 7. Update InvoiceTransmission → SENT
    await prisma.invoiceTransmission.update({
      where: { id: transmissionId },
      data: {
        status:            'SENT',
        providerMessageId: messageId,
        sentAt:            new Date(),
      },
    });

    // 8. Write AuditLog
    await prisma.auditLog.create({
      data: {
        tenantId,
        invoiceId,
        action:  'invoice.email.sent',
        payload: { to: recipientEmail, provider: EMAIL_PROVIDER, messageId },
      },
    });

    return { messageId };
  }
}

// ── HTML email template ───────────────────────────────────────────────────────

interface TemplateData {
  invoiceNumber: string;
  issueDate:     Date;
  dueDate:       Date;
  currency:      string;
  total:         number;
  subtotal:      number;
  taxAmount:     number;
  buyerName:     string;
  sellerName:    string;
  sellerIban:    string | null | undefined;
  sellerEmail:   string;
  note:          string | null | undefined;
  lines: {
    description: string;
    quantity:    number;
    unit:        string;
    unitPrice:   number;
    lineTotal:   number;
    taxRate:     number;
  }[];
}

function fmt2(n: number) { return n.toFixed(2); }
function fmtDate(d: Date) { return new Date(d).toISOString().slice(0, 10); }

function buildEmailHtml(d: TemplateData): string {
  const lineRows = d.lines
    .map(
      (l) => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;">${l.description}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;">${l.quantity}&nbsp;${l.unit}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;">${fmt2(l.unitPrice)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;">${l.taxRate}%</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;">${fmt2(l.lineTotal)}</td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${d.invoiceNumber}</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a2e;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.09);">

  <!-- Header -->
  <tr><td style="background:#1a1a2e;padding:30px 36px;">
    <p style="margin:0;font-size:24px;font-weight:700;color:#fff;letter-spacing:.5px;">${d.sellerName}</p>
    <p style="margin:6px 0 0;font-size:13px;color:#8899bb;">Invoice&nbsp;${d.invoiceNumber}</p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:28px 36px 0;">
    <p style="margin:0 0 10px;font-size:15px;">Dear <strong>${d.buyerName}</strong>,</p>
    <p style="margin:0;color:#444;line-height:1.6;">
      Please find attached invoice <strong>${d.invoiceNumber}</strong> for
      <strong>${fmt2(d.total)}&nbsp;${d.currency}</strong>.
      Full details are below and the invoice PDF and UBL XML are attached for your records.
    </p>
  </td></tr>

  <!-- Summary banner -->
  <tr><td style="padding:20px 36px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e8ef;border-radius:8px;overflow:hidden;">
      <tr style="background:#f8f9fb;">
        <th style="padding:11px 14px;text-align:left;font-size:12px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Invoice&nbsp;#</th>
        <th style="padding:11px 14px;text-align:left;font-size:12px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Issue&nbsp;Date</th>
        <th style="padding:11px 14px;text-align:left;font-size:12px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Due&nbsp;Date</th>
        <th style="padding:11px 14px;text-align:right;font-size:12px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Amount&nbsp;Due</th>
      </tr>
      <tr>
        <td style="padding:14px;">${d.invoiceNumber}</td>
        <td style="padding:14px;">${fmtDate(d.issueDate)}</td>
        <td style="padding:14px;color:#b91c1c;font-weight:600;">${fmtDate(d.dueDate)}</td>
        <td style="padding:14px;text-align:right;font-size:20px;font-weight:700;color:#1a1a2e;">${fmt2(d.total)}&nbsp;${d.currency}</td>
      </tr>
    </table>
  </td></tr>

  <!-- Line items -->
  <tr><td style="padding:24px 36px 0;">
    <p style="margin:0 0 10px;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#555;">Line Items</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border:1px solid #e4e8ef;border-radius:8px;overflow:hidden;">
      <tr style="background:#f8f9fb;">
        <th style="padding:9px 10px;text-align:left;font-weight:600;color:#555;">Description</th>
        <th style="padding:9px 10px;text-align:right;font-weight:600;color:#555;">Qty</th>
        <th style="padding:9px 10px;text-align:right;font-weight:600;color:#555;">Unit&nbsp;Price</th>
        <th style="padding:9px 10px;text-align:right;font-weight:600;color:#555;">VAT</th>
        <th style="padding:9px 10px;text-align:right;font-weight:600;color:#555;">Total</th>
      </tr>
      ${lineRows}
      <tr style="background:#f8f9fb;border-top:1px solid #e4e8ef;">
        <td colspan="4" style="padding:9px 10px;text-align:right;color:#555;">Subtotal</td>
        <td style="padding:9px 10px;text-align:right;color:#555;">${fmt2(d.subtotal)}&nbsp;${d.currency}</td>
      </tr>
      <tr style="background:#f8f9fb;">
        <td colspan="4" style="padding:9px 10px;text-align:right;color:#888;">VAT</td>
        <td style="padding:9px 10px;text-align:right;color:#888;">${fmt2(d.taxAmount)}&nbsp;${d.currency}</td>
      </tr>
      <tr style="border-top:2px solid #1a1a2e;">
        <td colspan="4" style="padding:12px 10px;text-align:right;font-weight:700;font-size:15px;">Total</td>
        <td style="padding:12px 10px;text-align:right;font-weight:700;font-size:15px;">${fmt2(d.total)}&nbsp;${d.currency}</td>
      </tr>
    </table>
  </td></tr>

  <!-- Payment details -->
  <tr><td style="padding:24px 36px;">
    <div style="background:#eff6ff;border-radius:8px;padding:20px 22px;border-left:4px solid #2563eb;">
      <p style="margin:0 0 10px;font-weight:700;font-size:13px;color:#1d4ed8;text-transform:uppercase;letter-spacing:.5px;">Payment Details</p>
      <table cellpadding="0" cellspacing="0" style="font-size:13px;line-height:2;">
        <tr><td style="color:#555;padding-right:16px;">Account&nbsp;name</td><td><strong>${d.sellerName}</strong></td></tr>
        <tr><td style="color:#555;">IBAN</td><td><strong>${d.sellerIban ?? '(contact us for bank details)'}</strong></td></tr>
        <tr><td style="color:#555;">Reference</td><td><strong>${d.invoiceNumber}</strong></td></tr>
      </table>
    </div>
  </td></tr>

  ${d.note ? `
  <tr><td style="padding:0 36px 24px;">
    <p style="margin:0;font-size:13px;color:#666;border-top:1px solid #eee;padding-top:16px;">
      <strong>Note:</strong> ${d.note}
    </p>
  </td></tr>` : ''}

  <!-- Footer -->
  <tr><td style="background:#f8f9fb;padding:20px 36px;text-align:center;font-size:12px;color:#888;border-top:1px solid #eee;">
    <p style="margin:0;">Questions? Contact
      <a href="mailto:${d.sellerEmail}" style="color:#2563eb;text-decoration:none;">${d.sellerEmail}</a>
    </p>
    <p style="margin:8px 0 0;">This invoice email was sent by ${d.sellerName} via InvoicePlatform.
      <a href="#" style="color:#aaa;">Unsubscribe</a>
    </p>
  </td></tr>

</table>
</td></tr></table>
</body>
</html>`;
}
