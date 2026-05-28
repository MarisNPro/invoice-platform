import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { OrganisationService } from './organisation.service';

@Controller('organisations')
export class OrganisationController {
  constructor(private readonly organisations: OrganisationService) {}

  /**
   * GET /api/v1/organisations/me
   * Returns the authenticated user's organisation with AI spend summary.
   */
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.organisations.getMe(user.tenant_id ?? '');
  }
}
