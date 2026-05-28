import {
  Body,
  Controller,
  DefaultValuePipe,
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
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, Role } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { CreateInvoiceBodyDto } from './dto/create-invoice.dto';
import type { CreateInvoiceDto } from './invoice.types';

@Controller('invoices')
@UseGuards(RolesGuard)
export class InvoiceController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly pdf:      InvoicePdfService,
    private readonly ubl:      InvoiceUblService,
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
    @Query('status') status?: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page  = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.invoices.findAll(user.tenant_id ?? '', status, page, limit);
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

  // ── Legacy POST with full internal DTO (kept for internal tooling) ────────
  @Post('internal')
  @Roles(Role.ADMIN)
  createInternal(@Body() dto: CreateInvoiceDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.create({ ...dto, tenantId: user.tenant_id ?? dto.tenantId });
  }
}
