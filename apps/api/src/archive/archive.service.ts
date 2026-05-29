import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { encryptToken, decryptToken } from './crypto.util';
import type { CloudProvider } from '@prisma/client';
import axios from 'axios';

// ── Provider configuration ────────────────────────────────────────────────────

interface ProviderConfig {
  label:       string;
  authUrl:     string;
  tokenUrl:    string;
  revokeUrl:   string | null;
  scope:       string;
  clientIdKey:     string;
  clientSecretKey: string;
  redirectUriKey:  string;
}

const PROVIDER_CFG: Record<CloudProvider, ProviderConfig> = {
  GOOGLE_DRIVE: {
    label:           'Google Drive',
    authUrl:         'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl:        'https://oauth2.googleapis.com/token',
    revokeUrl:       'https://oauth2.googleapis.com/revoke',
    scope:           'https://www.googleapis.com/auth/drive.file',
    clientIdKey:     'GOOGLE_CLIENT_ID',
    clientSecretKey: 'GOOGLE_CLIENT_SECRET',
    redirectUriKey:  'GOOGLE_REDIRECT_URI',
  },
  DROPBOX: {
    label:           'Dropbox',
    authUrl:         'https://www.dropbox.com/oauth2/authorize',
    tokenUrl:        'https://api.dropboxapi.com/oauth2/token',
    revokeUrl:       'https://api.dropboxapi.com/2/auth/token/revoke',
    scope:           'files.content.write files.metadata.write',
    clientIdKey:     'DROPBOX_APP_KEY',
    clientSecretKey: 'DROPBOX_APP_SECRET',
    redirectUriKey:  'DROPBOX_REDIRECT_URI',
  },
  ONEDRIVE: {
    label:           'OneDrive',
    authUrl:         'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl:        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    revokeUrl:       null,
    scope:           'https://graph.microsoft.com/Files.ReadWrite.All offline_access',
    clientIdKey:     'ONEDRIVE_CLIENT_ID',
    clientSecretKey: 'ONEDRIVE_CLIENT_SECRET',
    redirectUriKey:  'ONEDRIVE_REDIRECT_URI',
  },
};

const ALL_PROVIDERS: CloudProvider[] = ['GOOGLE_DRIVE', 'DROPBOX', 'ONEDRIVE'];

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ArchiveService {
  private readonly logger = new Logger(ArchiveService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly config:  ConfigService,
  ) {}

  // ── GET /archive/providers ─────────────────────────────────────────────────

  async getProviders(tenantId: string) {
    const records = await this.prisma.cloudArchive.findMany({
      where: { tenantId },
    });
    const byProvider = new Map(records.map((r) => [r.provider, r]));

    return ALL_PROVIDERS.map((provider) => {
      const cfg    = PROVIDER_CFG[provider];
      const record = byProvider.get(provider);
      return {
        provider,
        label:       cfg.label,
        isConnected: record?.isActive ?? false,
        folderPath:  record?.folderPath ?? '/InvoiceArchive',
        lastSyncAt:  record?.lastSyncAt ?? null,
        scope:       cfg.scope,
      };
    });
  }

  // ── GET /archive/connect/:provider — returns OAuth redirect URL ────────────

  getAuthUrl(provider: CloudProvider, tenantId: string): string {
    const cfg = PROVIDER_CFG[provider];

    const clientId   = this.config.get<string>(cfg.clientIdKey);
    const redirectUri = this.config.get<string>(cfg.redirectUriKey,
      `http://localhost:4000/api/v1/archive/callback/${provider.toLowerCase()}`);

    if (!clientId) {
      throw new BadRequestException(
        `${provider} OAuth is not configured — set ${cfg.clientIdKey} in your environment`,
      );
    }

    // State encodes tenantId (base64) for callback verification
    const state = Buffer.from(tenantId).toString('base64url');

    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         cfg.scope,
      state,
      access_type:   'offline',   // Google: ensures refresh_token
      prompt:        'consent',   // Google: force consent even if previously granted
    });

    // Dropbox uses token_access_type instead of access_type
    if (provider === 'DROPBOX') {
      params.delete('access_type');
      params.delete('prompt');
      params.set('token_access_type', 'offline');
    }
    // OneDrive: no access_type/prompt
    if (provider === 'ONEDRIVE') {
      params.delete('access_type');
      params.delete('prompt');
    }

    return `${cfg.authUrl}?${params.toString()}`;
  }

  // ── GET /archive/callback/:provider — exchange code, store encrypted ───────

  async handleCallback(provider: CloudProvider, code: string, state: string): Promise<void> {
    const tenantId = Buffer.from(state, 'base64url').toString('utf8');
    if (!tenantId) throw new BadRequestException('Invalid state parameter');

    const cfg         = PROVIDER_CFG[provider];
    const clientId    = this.config.get<string>(cfg.clientIdKey, '');
    const clientSecret = this.config.get<string>(cfg.clientSecretKey, '');
    const redirectUri  = this.config.get<string>(cfg.redirectUriKey,
      `http://localhost:4000/api/v1/archive/callback/${provider.toLowerCase()}`);
    const encKey = this.encryptionKey();

    // Exchange authorization code for tokens
    const params = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      client_secret: clientSecret,
    });

    const { data } = await axios.post<{
      access_token:  string;
      refresh_token: string;
      expires_in?:   number;
    }>(cfg.tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    });

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await this.prisma.cloudArchive.upsert({
      where:  { tenantId_provider: { tenantId, provider } },
      create: {
        tenantId,
        provider,
        accessToken:    encryptToken(data.access_token, encKey),
        refreshToken:   encryptToken(data.refresh_token ?? '', encKey),
        tokenExpiresAt: expiresAt,
        folderPath:     '/InvoiceArchive',
        isActive:       true,
      },
      update: {
        accessToken:    encryptToken(data.access_token, encKey),
        refreshToken:   encryptToken(data.refresh_token ?? '', encKey),
        tokenExpiresAt: expiresAt,
        isActive:       true,
      },
    });

    this.logger.log(`${provider} connected for tenant ${tenantId}`);
  }

  // ── DELETE /archive/disconnect/:provider ──────────────────────────────────

  async disconnect(provider: CloudProvider, tenantId: string): Promise<void> {
    const record = await this.prisma.cloudArchive.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });
    if (!record || !record.isActive) return;

    // Best-effort token revocation
    const cfg = PROVIDER_CFG[provider];
    if (cfg.revokeUrl) {
      try {
        const accessToken = decryptToken(record.accessToken, this.encryptionKey());
        if (provider === 'GOOGLE_DRIVE') {
          await axios.post(cfg.revokeUrl, new URLSearchParams({ token: accessToken }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 6_000,
          });
        } else if (provider === 'DROPBOX') {
          await axios.post(cfg.revokeUrl, null, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 6_000,
          });
        }
      } catch (err) {
        this.logger.warn(`Token revocation failed (non-fatal): ${(err as Error).message}`);
      }
    }

    await this.prisma.cloudArchive.update({
      where: { tenantId_provider: { tenantId, provider } },
      data:  { isActive: false },
    });

    this.logger.log(`${provider} disconnected for tenant ${tenantId}`);
  }

  // ── GET /archive/status ───────────────────────────────────────────────────

  async getStatus(tenantId: string) {
    const records = await this.prisma.cloudArchive.findMany({
      where: { tenantId },
    });
    const byProvider = new Map(records.map((r) => [r.provider, r]));

    return ALL_PROVIDERS.map((provider) => {
      const record = byProvider.get(provider);
      return {
        provider,
        label:       PROVIDER_CFG[provider].label,
        isConnected: record?.isActive ?? false,
        folderPath:  record?.folderPath ?? '/InvoiceArchive',
        lastSyncAt:  record?.lastSyncAt ?? null,
        lastError:   null as string | null,
      };
    });
  }

  // ── Token refresh (used by sync job) ─────────────────────────────────────

  async refreshTokenIfNeeded(recordId: string): Promise<string> {
    const record = await this.prisma.cloudArchive.findUniqueOrThrow({ where: { id: recordId } });
    const encKey = this.encryptionKey();

    // Refresh if token expires within 60 minutes
    const needsRefresh =
      record.tokenExpiresAt &&
      record.tokenExpiresAt.getTime() < Date.now() + 60 * 60 * 1000;

    if (!needsRefresh) {
      return decryptToken(record.accessToken, encKey);
    }

    const cfg          = PROVIDER_CFG[record.provider];
    const clientId     = this.config.get<string>(cfg.clientIdKey, '');
    const clientSecret = this.config.get<string>(cfg.clientSecretKey, '');
    const refreshToken = decryptToken(record.refreshToken, encKey);

    const params = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
    });

    const { data } = await axios.post<{ access_token: string; expires_in?: number }>(
      cfg.tokenUrl, params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
    );

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await this.prisma.cloudArchive.update({
      where: { id: recordId },
      data: {
        accessToken:    encryptToken(data.access_token, encKey),
        tokenExpiresAt: expiresAt,
      },
    });

    this.logger.log(`Refreshed ${record.provider} token for tenant ${record.tenantId}`);
    return data.access_token;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private encryptionKey(): string {
    return this.config.get<string>('ARCHIVE_ENCRYPTION_KEY', '0'.repeat(64));
  }
}
