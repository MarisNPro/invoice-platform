import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles, Role } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminService } from './admin.service';

/**
 * Superadmin endpoints — require ADMIN Keycloak realm role.
 * In local dev, use x-dev-tenant-id header to bypass Keycloak auth.
 *
 * GET /api/v1/admin/ai-costs — per-org AI spend vs plan revenue + margin flags
 */
@Controller('admin')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('ai-costs')
  getAiCosts() {
    return this.admin.getAiCosts();
  }
}
