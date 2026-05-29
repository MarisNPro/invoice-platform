import {
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('contacts')
@UseGuards(RolesGuard)
export class ContactController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/v1/contacts
   * Search tenant contacts by name, VAT or business ID.
   */
  @Get()
  search(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('isCustomer') isCustomer?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    const tenantId = user.tenant_id ?? '';
    return this.prisma.contact.findMany({
      where: {
        tenantId,
        ...(isCustomer === 'true' ? { isCustomer: true } : {}),
        ...(search?.trim()
          ? {
              OR: [
                { name:       { contains: search.trim(), mode: 'insensitive' } },
                { vatNumber:  { contains: search.trim(), mode: 'insensitive' } },
                { businessId: { contains: search.trim(), mode: 'insensitive' } },
                { email:      { contains: search.trim(), mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { addresses: { orderBy: { isDefault: 'desc' }, take: 1 } },
      take: limit,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * GET /api/v1/contacts/customers
   * Returns all customer contacts with aggregated invoice stats.
   * NOTE: must be declared before :id to avoid route conflict.
   */
  @Get('customers')
  async getCustomers(@CurrentUser() user: JwtPayload) {
    const tenantId = user.tenant_id ?? '';

    const contacts = await this.prisma.contact.findMany({
      where:   { tenantId, isCustomer: true },
      include: { addresses: { where: { isDefault: true }, take: 1 } },
      orderBy: { name: 'asc' },
    });

    if (contacts.length === 0) return [];

    // Single aggregate query for all customers at once
    const stats = await this.prisma.invoice.groupBy({
      by:    ['buyerId'],
      where: { tenantId, buyerId: { in: contacts.map((c) => c.id) } },
      _count: { _all: true },
      _sum:   { total: true },
      _max:   { issuedAt: true },
    });

    const statsMap = new Map(stats.map((s) => [s.buyerId, s]));

    return contacts.map((c) => {
      const s = statsMap.get(c.id);
      return {
        id:              c.id,
        name:            c.name,
        vatNumber:       c.vatNumber,
        businessId:      c.businessId,
        country:         c.country,
        email:           c.email,
        phone:           c.phone,
        address:         c.addresses[0] ?? null,
        invoiceCount:    s?._count._all      ?? 0,
        totalInvoiced:   Number(s?._sum.total ?? 0),
        lastInvoiceDate: s?._max.issuedAt    ?? null,
      };
    });
  }

  /**
   * GET /api/v1/contacts/:id
   * Returns a single contact with addresses.
   */
  @Get(':id')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const tenantId = user.tenant_id ?? '';
    const contact  = await this.prisma.contact.findFirst({
      where:   { id, tenantId },
      include: { addresses: { orderBy: { isDefault: 'desc' } } },
    });
    if (!contact) throw new NotFoundException(`Contact ${id} not found`);
    return contact;
  }
}
