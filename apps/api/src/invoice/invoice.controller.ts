import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, Role } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import type { CreateInvoiceDto } from './invoice.types';

@Controller('invoices')
@UseGuards(RolesGuard)
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Post()
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: JwtPayload) {
    // Enforce tenant scope from JWT
    return this.invoices.create({ ...dto, tenantId: user.tenant_id ?? dto.tenantId });
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    const tenantId = user.tenant_id ?? '';
    return this.invoices.findAll(tenantId, status);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.invoices.findOne(user.tenant_id ?? '', id);
  }

  @Patch(':id/send')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  markSent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.invoices.markSent(user.tenant_id ?? '', id);
  }

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
}
