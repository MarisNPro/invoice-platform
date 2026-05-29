import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Ip,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { InvoiceService } from './invoice.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceUblService } from './invoice-ubl.service';
import { AiService } from '../ai/ai.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, Role } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PlanLimitGuard } from '../auth/plan-limit.guard';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { CreateInvoiceBodyDto } from './dto/create-invoice.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { DunningMessageDto } from './dto/dunning-message.dto';
import { SendInvoiceDto } from './dto/send-invoice.dto';
import type { CreateInvoiceDto } from './invoice.types';
import type { DunnableInvoice, ReviewableInvoice } from '../ai/ai.service';

@Controller('invoices')
@UseGuards(RolesGuard)
export class InvoiceController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly pdf:      InvoicePdfService,
    private readonly ubl:      InvoiceUblService,
    private readonly ai:       AiService,
  ) {}

  // ── POST /api/v1/invoices ─────────────────────────────────────────────────
  /**
   * Creates a new DRAFT invoice.
   * Requires ACCOUNTANT or ADMIN role.
   * Seller is resolved from the tenantId JWT claim.
   * All BG-22 totals are computed server-side.
   */
  @Post()
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  create(
    @Body() dto:  CreateInvoiceBodyDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const tenantId = user.tenant_id ?? '';
    return this.invoices.createFromApi(dto, tenantId, user.sub, ip);
  }

  // ── GET /api/v1/invoices ──────────────────────────────────────────────────
  /**
   * Lists invoices with pagination. Optional ?status= filter.
   * Query params: status, page (default 1), limit (default 20).
   */
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('status')    status?:    string,
    @Query('buyerId')   buyerId?:   string,
    @Query('from')      from?:      string,
    @Query('to')        to?:        string,
    @Query('minAmount') minAmountStr?: string,
    @Query('maxAmount') maxAmountStr?: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page  = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    const minAmount = minAmountStr !== undefined ? Number(minAmountStr) : undefined;
    const maxAmount = maxAmountStr !== undefined ? Number(maxAmountStr) : undefined;
    return this.invoices.findAll(
      user.tenant_id ?? '', status, page, limit, buyerId, from, to, minAmount, maxAmount,
    );
  }

  // ── GET /api/v1/invoices/:idOrNumber/pdf ─────────────────────────────────
  /**
   * Download invoice as PDF.
   * :idOrNumber can be either a UUID or an invoice number (e.g. INV-2024-00002).
   * Returns application/pdf with Content-Disposition: attachment.
   */
  @Get(':idOrNumber/pdf')
  async getPdf(
    @Param('idOrNumber') idOrNumber: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    const { buffer, filename } = await this.pdf.generate(
      user.tenant_id ?? '',
      idOrNumber,
    );

    void res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', String(buffer.length))
      .send(buffer);
  }

  // ── GET /api/v1/invoices/:idOrNumber/ubl ─────────────────────────────────
  /**
   * Download invoice as Peppol BIS Billing 3.0 UBL 2.1 XML.
   * :idOrNumber can be either a UUID or an invoice number (e.g. INV-2024-00002).
   * Returns application/xml with Content-Disposition: attachment.
   */
  @Get(':idOrNumber/ubl')
  async getUbl(
    @Param('idOrNumber') idOrNumber: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    const { xml, filename } = await this.ubl.generate(
      user.tenant_id ?? '',
      idOrNumber,
    );

    const bytes = Buffer.from(xml, 'utf8');
    void res
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', String(bytes.length))
      .send(bytes);
  }

  // ── POST /api/v1/invoices/:idOrNumber/review ─────────────────────────────
  /**
   * AI-powered EN 16931 compliance review of an existing invoice.
   * Checks arithmetic, mandatory fields, VAT categories, date sanity.
   *
   * Returns: { issues, suggestions, approved, confidence }
   * Requires ACCOUNTANT or ADMIN role.
   */
  @Post(':idOrNumber/review')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  @UseGuards(PlanLimitGuard)
  async reviewInvoice(
    @Param('idOrNumber') idOrNumber: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const tenantId = user.tenant_id ?? '';

    // Load the full invoice (UUID or invoice number both accepted)
    const inv = await this.invoices.findByIdOrNumber(tenantId, idOrNumber);

    // Map to the ReviewableInvoice shape AiService expects
    const reviewable: ReviewableInvoice = {
      number:   inv.number,
      currency: inv.currencyCode,
      issueDate: inv.issuedAt,
      dueDate:   inv.dueAt,
      subtotal:  Number(inv.subtotal),
      taxAmount: Number(inv.taxAmount),
      total:     Number(inv.total),
      seller: {
        name:       inv.seller.name,
        vatNumber:  inv.seller.vatNumber,
        businessId: inv.seller.businessId,
        country:    inv.seller.country,
      },
      buyer: {
        name:       inv.buyer.name,
        vatNumber:  inv.buyer.vatNumber,
        businessId: inv.buyer.businessId,
        country:    inv.buyer.country,
      },
      lines: inv.lines.map((ln) => ({
        lineNumber:     ln.lineNumber,
        description:    ln.description,
        quantity:       Number(ln.quantity),
        unit:           ln.unit,
        unitPrice:      Number(ln.unitPrice),
        lineTotal:      Number(ln.lineTotal),
        taxAmount:      Number(ln.taxAmount),
        vatRatePercent: ln.taxRate
          ? Math.round(Number(ln.taxRate.rate) * 10000) / 100
          : undefined,
      })),
      vatBreakdowns: inv.vatBreakdowns.map((vb) => ({
        vatCategoryCode: vb.vatCategoryCode,
        vatRatePercent:  Number(vb.vatRatePercent),
        taxableAmount:   Number(vb.taxableAmount),
        taxAmount:       Number(vb.taxAmount),
      })),
      note:             inv.note,
      paymentTermsNote: inv.paymentTermsNote,
    };

    return this.ai.reviewInvoice(reviewable, tenantId);
  }

  // ── POST /api/v1/invoices/:idOrNumber/dunning-message ────────────────────
  /**
   * Generate a culturally appropriate payment dunning message for an overdue
   * invoice. Tone (polite → formal notice) is derived automatically from days
   * overdue. Language rules (salutation, name order, closing formula) are
   * enforced per-locale by the AI system prompt.
   *
   * Body: { language: string, channel: "email" | "whatsapp" }
   * Returns: { subject, body, tone, daysOverdue, languageQualityNotes }
   */
  @Post(':idOrNumber/dunning-message')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  @UseGuards(PlanLimitGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async generateDunningMessage(
    @Param('idOrNumber') idOrNumber: string,
    @Body() dto: DunningMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const tenantId = user.tenant_id ?? '';
    const inv = await this.invoices.findByIdOrNumber(tenantId, idOrNumber);

    const dunnableInvoice: DunnableInvoice = {
      number:       inv.number,
      currencyCode: inv.currencyCode,
      total:        Number(inv.total),
      issuedAt:     inv.issuedAt,
      dueAt:        inv.dueAt,
      buyer: {
        name:    inv.buyer.name,
        email:   inv.buyer.email,
        phone:   inv.buyer.phone,
        country: inv.buyer.country,
      },
      seller: {
        name:  inv.seller.name,
        email: inv.seller.email,
        phone: inv.seller.phone,
        iban:  inv.seller.iban,
      },
    };

    return this.ai.generateDunningMessage(dunnableInvoice, dto.language, dto.channel, tenantId);
  }

  // ── POST /api/v1/invoices/:idOrNumber/send ───────────────────────────────
  /**
   * Queues an invoice for email delivery via BullMQ → worker → Resend/MailHog.
   * Body: { channel: "email", recipientEmail?: string }
   *   - recipientEmail defaults to the buyer contact's email if omitted.
   *   - Returns 400 if no email is available.
   * Returns: { jobId, transmissionId, message }
   */
  @Post(':idOrNumber/send')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async sendInvoiceEmail(
    @Param('idOrNumber') idOrNumber: string,
    @Body() dto: SendInvoiceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const { jobId, transmissionId } = await this.invoices.enqueueSend(
      user.tenant_id ?? '',
      idOrNumber,
      dto,
    );
    return { jobId, transmissionId, message: 'Invoice queued for sending' };
  }

  // ── GET /api/v1/invoices/:id ──────────────────────────────────────────────
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.invoices.findOne(user.tenant_id ?? '', id);
  }

  // ── PATCH /api/v1/invoices/:id/send ──────────────────────────────────────
  @Patch(':id/send')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  markSent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.invoices.markSent(user.tenant_id ?? '', id);
  }

  // ── PATCH /api/v1/invoices/:id/pay ───────────────────────────────────────
  @Patch(':id/pay')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  markPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { amount: number; paidAt: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.invoices.markPaid(
      user.tenant_id ?? '',
      id,
      body.amount,
      new Date(body.paidAt),
    );
  }

  // ── POST /api/v1/invoices/:idOrNumber/credit-note ─────────────────────────
  /**
   * Creates a credit note for an existing invoice.
   * Empty lines → full credit (all original lines negated).
   * Provided lines → partial credit note.
   * Number format: CN-YYYY-NNNNN (own sequence per tenant/year).
   * UBL type code 381. BillingReference BT-25 links back to original.
   */
  @Post(':idOrNumber/credit-note')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  createCreditNote(
    @Param('idOrNumber') idOrNumber: string,
    @Body() dto: CreateCreditNoteDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.invoices.createCreditNote(
      user.tenant_id ?? '',
      idOrNumber,
      dto,
      user.sub,
      ip,
    );
  }

  // ── POST /api/v1/invoices/:id/payments ────────────────────────────────────
  /**
   * Records a payment against an invoice.
   * Validates amount does not exceed remaining balance.
   * Automatically sets status to PAID or PARTIALLY_PAID.
   */
  @Post(':id/payments')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.invoices.recordPayment(
      user.tenant_id ?? '',
      id,
      dto,
      user.sub,
      ip,
    );
  }

  // ── GET /api/v1/invoices/:id/payments ─────────────────────────────────────
  /**
   * Returns all payments for an invoice with balance summary.
   * Returns: { payments, totalPaid, remaining, isPaid, percentPaid, currency }
   */
  @Get(':id/payments')
  getPayments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.invoices.getPayments(user.tenant_id ?? '', id);
  }

  // ── DELETE /api/v1/invoices/:id/payments/:paymentId ───────────────────────
  /**
   * Deletes a payment and recalculates invoice status.
   */
  @Delete(':id/payments/:paymentId')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  deletePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.invoices.deletePayment(user.tenant_id ?? '', id, paymentId);
  }

  // ── Legacy POST with full internal DTO (kept for internal tooling) ────────
  @Post('internal')
  @Roles(Role.ADMIN)
  createInternal(@Body() dto: CreateInvoiceDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.create({ ...dto, tenantId: user.tenant_id ?? dto.tenantId });
  }
}
