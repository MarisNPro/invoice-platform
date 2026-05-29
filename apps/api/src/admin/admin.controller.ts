import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { Role, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminService } from './admin.service';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UpdateVatRateDto } from './dto/update-vat-rate.dto';

@Controller('admin')
@UseGuards(RolesGuard)
@Roles(Role.SUPERADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // 1. GET /admin/organisations
  @Get('organisations')
  getOrganisations(
    @Query('tier')    tier?:    string,
    @Query('country') country?: string,
    @Query('search')  search?:  string,
  ) {
    return this.admin.getOrganisations({ tier, country, search });
  }

  // 2. PATCH /admin/organisations/:id/plan
  @Patch('organisations/:id/plan')
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.updatePlan(id, dto, user.sub);
  }

  // 3. POST /admin/organisations/:id/reset-counters
  @Post('organisations/:id/reset-counters')
  resetCounters(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.resetCounters(id, user.sub);
  }

  // 4. GET /admin/users
  @Get('users')
  getUsers(
    @Query('search')   search?:   string,
    @Query('isActive') isActive?: string,
  ) {
    const active = isActive !== undefined ? isActive === 'true' : undefined;
    return this.admin.getUsers({ search, isActive: active });
  }

  // 5. POST /admin/users/:id/impersonate
  @Post('users/:id/impersonate')
  impersonateUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.impersonateUser(id, user.sub);
  }

  // 6. POST /admin/users/:id/disable
  @Post('users/:id/disable')
  disableUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.disableUser(id, user.sub);
  }

  // 7. GET /admin/audit-logs  (?format=csv for download)
  @Get('audit-logs')
  async getAuditLogs(
    @Query('orgId')  orgId?:  string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('from')   from?:   string,
    @Query('to')     to?:     string,
    @Query('page')   page?:   string,
    @Query('limit')  limit?:  string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ) {
    const result = await this.admin.getAuditLogs({
      orgId, userId, action, from, to,
      page:  page  ? Number(page)  : undefined,
      limit: limit ? Number(limit) : undefined,
      format,
    });

    if (format === 'csv' && reply) {
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    }

    return result;
  }

  // 8. GET /admin/api-keys
  @Get('api-keys')
  getApiKeys() {
    return this.admin.getApiKeys();
  }

  // 9. DELETE /admin/api-keys/:id
  @Delete('api-keys/:id')
  revokeApiKey(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.revokeApiKey(id, user.sub);
  }

  // 10. GET /admin/sessions
  @Get('sessions')
  getSessions() {
    return this.admin.getSessions();
  }

  // 11. DELETE /admin/sessions/:userId
  @Delete('sessions/:userId')
  terminateUserSessions(
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.terminateUserSessions(userId, user.sub);
  }

  // 12. GET /admin/system-health
  @Get('system-health')
  getSystemHealth() {
    return this.admin.getSystemHealth();
  }

  // 13. GET /admin/ai-costs
  @Get('ai-costs')
  getAiCosts() {
    return this.admin.getAiCosts();
  }

  // 14. GET /admin/vat-rates
  @Get('vat-rates')
  getVatRates() {
    return this.admin.getVatRates();
  }

  // 15. PATCH /admin/vat-rates/:id
  @Patch('vat-rates/:id')
  updateVatRate(
    @Param('id') id: string,
    @Body() dto: UpdateVatRateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.updateVatRate(id, dto, user.sub);
  }
}
