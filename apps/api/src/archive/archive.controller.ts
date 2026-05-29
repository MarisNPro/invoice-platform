import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { ArchiveService } from './archive.service';
import type { CloudProvider } from '@prisma/client';

const VALID_PROVIDERS: CloudProvider[] = ['GOOGLE_DRIVE', 'DROPBOX', 'ONEDRIVE'];

function toProvider(raw: string): CloudProvider {
  const upper = raw.toUpperCase().replace(/-/g, '_') as CloudProvider;
  if (!VALID_PROVIDERS.includes(upper)) {
    throw new Error(`Unknown provider: ${raw}. Valid: ${VALID_PROVIDERS.join(', ')}`);
  }
  return upper;
}

@Controller('archive')
export class ArchiveController {
  constructor(
    private readonly archive: ArchiveService,
    private readonly config:  ConfigService,
  ) {}

  /**
   * GET /api/v1/archive/providers
   * Returns all 3 providers with isConnected + folderPath for this tenant.
   */
  @Get('providers')
  getProviders(@CurrentUser() user: JwtPayload) {
    return this.archive.getProviders(user.tenant_id ?? '');
  }

  /**
   * GET /api/v1/archive/status
   * Returns [{provider, isConnected, folderPath, lastSyncAt, lastError}].
   */
  @Get('status')
  getStatus(@CurrentUser() user: JwtPayload) {
    return this.archive.getStatus(user.tenant_id ?? '');
  }

  /**
   * GET /api/v1/archive/connect/:provider
   * Redirects the user to the provider's OAuth consent screen.
   */
  @Get('connect/:provider')
  connect(
    @Param('provider') providerRaw: string,
    @CurrentUser() user: JwtPayload,
    @Res() reply: FastifyReply,
  ) {
    const provider = toProvider(providerRaw);
    const url      = this.archive.getAuthUrl(provider, user.tenant_id ?? '');
    void reply.redirect(302, url);
  }

  /**
   * GET /api/v1/archive/callback/:provider
   * OAuth callback — exchanges code for tokens, stores encrypted, redirects to UI.
   */
  @Get('callback/:provider')
  async callback(
    @Param('provider') providerRaw: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() reply: FastifyReply,
  ) {
    const provider    = toProvider(providerRaw);
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');

    try {
      await this.archive.handleCallback(provider, code, state);
      void reply.redirect(302, `${frontendUrl}/settings/archive?connected=true&provider=${provider}`);
    } catch (err) {
      const msg = encodeURIComponent((err as Error).message);
      void reply.redirect(302, `${frontendUrl}/settings/archive?error=${msg}`);
    }
  }

  /**
   * DELETE /api/v1/archive/disconnect/:provider
   * Revokes token with provider + sets isActive=false.
   */
  @Delete('disconnect/:provider')
  async disconnect(
    @Param('provider') providerRaw: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const provider = toProvider(providerRaw);
    await this.archive.disconnect(provider, user.tenant_id ?? '');
    return { provider, disconnected: true };
  }
}
