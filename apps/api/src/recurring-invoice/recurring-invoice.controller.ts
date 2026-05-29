import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { Role, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { CreateRecurringInvoiceDto } from './dto/create-recurring-invoice.dto';
import { UpdateRecurringInvoiceDto } from './dto/update-recurring-invoice.dto';

@Controller('recurring-invoices')
@UseGuards(RolesGuard)
export class RecurringInvoiceController {
  constructor(private readonly svc: RecurringInvoiceService) {}

  // POST /api/v1/recurring-invoices
  @Post()
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  create(
    @Body() dto: CreateRecurringInvoiceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.create(dto, user.tenant_id ?? '');
  }

  // GET /api/v1/recurring-invoices
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.svc.findAll(user.tenant_id ?? '');
  }

  // PATCH /api/v1/recurring-invoices/:id
  @Patch(':id')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringInvoiceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.update(id, dto, user.tenant_id ?? '');
  }

  // DELETE /api/v1/recurring-invoices/:id
  @Delete(':id')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.remove(id, user.tenant_id ?? '');
  }
}
