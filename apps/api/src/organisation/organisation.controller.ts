import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { OrganisationService } from './organisation.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

@Controller('organisations')
export class OrganisationController {
  constructor(private readonly organisations: OrganisationService) {}

  // ── GET /api/v1/organisations/me ─────────────────────────────────────────
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.organisations.getMe(user.tenant_id ?? '');
  }

  // ── POST /api/v1/organisations/api-keys ──────────────────────────────────
  /** Generate a new read-only API key (plain key returned once). */
  @Post('api-keys')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  createApiKey(
    @Body() dto: CreateApiKeyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.organisations.createApiKey(user.tenant_id ?? '', dto);
  }

  // ── GET /api/v1/organisations/api-keys ───────────────────────────────────
  /** List all active keys (id, name, prefix, lastUsedAt — never the hash). */
  @Get('api-keys')
  listApiKeys(@CurrentUser() user: JwtPayload) {
    return this.organisations.listApiKeys(user.tenant_id ?? '');
  }

  // ── DELETE /api/v1/organisations/api-keys/:id ────────────────────────────
  /** Revoke a key immediately (soft-delete). */
  @Delete('api-keys/:id')
  revokeApiKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.organisations.revokeApiKey(user.tenant_id ?? '', id);
  }

  // ── GET /api/v1/organisations/cowork-context ─────────────────────────────
  /**
   * Returns a CONTEXT.md file pre-filled with the org's company data, top
   * customers, and platform URLs — ready to paste into an AI system prompt.
   */
  @Get('cowork-context')
  async getCoworkContext(
    @CurrentUser() user: JwtPayload,
    @Res() reply: FastifyReply,
  ) {
    const md    = await this.organisations.getCoworkContext(user.tenant_id ?? '');
    const bytes = Buffer.from(md, 'utf8');
    void reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="CONTEXT.md"')
      .header('Content-Length', String(bytes.length))
      .send(bytes);
  }

  // ── POST /api/v1/organisations/api-keys/validate ─────────────────────────
  /**
   * Internal endpoint called by the MCP server to validate a ro_ DB key.
   * Returns { valid, orgId, customerId } — no JWT required (key IS the auth).
   */
  @Post('api-keys/validate')
  @Public()
  async validateApiKey(@Body() body: { key: string }) {
    const result = await this.organisations.validateDbApiKey(body.key ?? '');
    if (!result) return { valid: false };
    return { valid: true, orgId: result.orgId, customerId: result.customerId };
  }
}
