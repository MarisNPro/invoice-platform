import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
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
   * Search tenant contacts (customers) by name, VAT or business ID.
   * Returns id (UUID), name, vatNumber, businessId, country, email, addresses.
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
      include: {
        addresses: { orderBy: { isDefault: 'desc' }, take: 1 },
      },
      take: limit,
      orderBy: { name: 'asc' },
    });
  }
}
