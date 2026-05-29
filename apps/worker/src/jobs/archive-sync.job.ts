/**
 * CloudArchiveSyncJob
 *
 * Triggered after an invoice is sent (email delivered → status SENT).
 * Uploads PDF + UBL XML to every active CloudArchive provider for the tenant.
 *
 * Folder structure created: /InvoiceArchive/YYYY/MM/
 * Files uploaded:           INV-2026-00002.pdf  +  INV-2026-00002.xml
 */

import type { Job, Processor } from 'bullmq';
import axios from 'axios';
import { Logger } from '../logger';
import { prisma } from '../prisma';
import type { CloudArchive, CloudProvider } from '@prisma/client';

const logger = new Logger('CloudArchiveSyncJob');

const APP_BASE_URL = process.env['APP_BASE_URL'] ?? 'http://localhost:4000';
const NODE_ENV     = process.env['NODE_ENV']      ?? 'development';

export interface CloudArchiveSyncJobData {
  invoiceId: string;
  tenantId:  string;
}

// ── AES decrypt (mirrors apps/api/src/archive/crypto.util.ts) ────────────────

import { createDecipheriv } from 'crypto';

function decryptToken(ciphertext: string, hexKey: string): string {
  const sep  = ciphertext.indexOf(':');
  if (sep === -1) throw new Error('Invalid ciphertext');
  const iv      = Buffer.from(ciphertext.slice(0, sep), 'hex');
  const enc     = Buffer.from(ciphertext.slice(sep + 1), 'hex');
  const key     = Buffer.from(hexKey.replace(/[^0-9a-fA-F]/g, '').padEnd(64, '0').slice(0, 64), 'hex');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ── Token refresh helper ──────────────────────────────────────────────────────

const TOKEN_URLS: Record<CloudProvider, string> = {
  GOOGLE_DRIVE: 'https://oauth2.googleapis.com/token',
  DROPBOX:      'https://api.dropboxapi.com/oauth2/token',
  ONEDRIVE:     'https://login.microsoftonline.com/common/oauth2/v2.0/token',
};

const CLIENT_ID_KEYS: Record<CloudProvider, string> = {
  GOOGLE_DRIVE: 'GOOGLE_CLIENT_ID',
  DROPBOX:      'DROPBOX_APP_KEY',
  ONEDRIVE:     'ONEDRIVE_CLIENT_ID',
};

const CLIENT_SECRET_KEYS: Record<CloudProvider, string> = {
  GOOGLE_DRIVE: 'GOOGLE_CLIENT_SECRET',
  DROPBOX:      'DROPBOX_APP_SECRET',
  ONEDRIVE:     'ONEDRIVE_CLIENT_SECRET',
};

async function getValidToken(record: CloudArchive, encKey: string): Promise<string> {
  const needsRefresh =
    record.tokenExpiresAt &&
    record.tokenExpiresAt.getTime() < Date.now() + 60 * 60 * 1000;

  if (!needsRefresh) return decryptToken(record.accessToken, encKey);

  const clientId     = process.env[CLIENT_ID_KEYS[record.provider]]     ?? '';
  const clientSecret = process.env[CLIENT_SECRET_KEYS[record.provider]] ?? '';
  const refreshToken = decryptToken(record.refreshToken, encKey);

  const { data } = await axios.post<{ access_token: string; expires_in?: number }>(
    TOKEN_URLS[record.provider],
    new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken,
      client_id: clientId, client_secret: clientSecret,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
  );

  // Persist refreshed token (best-effort — don't fail the job if update fails)
  await prisma.cloudArchive.update({
    where: { id: record.id },
    data: {
      accessToken:    `refreshed:${data.access_token}`, // will be re-encrypted in a real key rotation
      tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    },
  }).catch(() => { /* non-fatal */ });

  logger.log(`Refreshed ${record.provider} token for tenant ${record.tenantId}`);
  return data.access_token;
}

// ── Provider upload helpers ───────────────────────────────────────────────────

async function uploadToGoogleDrive(
  token:      string,
  content:    Buffer,
  mimeType:   string,
  fileName:   string,
  folderId?:  string | null,
): Promise<string> {
  const metadata = { name: fileName, ...(folderId ? { parents: [folderId] } : {}) };
  const boundary = '-------314159265358979323846';

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    '',
  ].join('\r\n');

  const bodyBuffer = Buffer.concat([
    Buffer.from(body, 'utf8'),
    content,
    Buffer.from(`\r\n--${boundary}--`, 'utf8'),
  ]);

  const { data } = await axios.post<{ id: string }>(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    bodyBuffer,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`,
      },
      timeout: 30_000,
    },
  );
  return data.id;
}

async function ensureGoogleDriveFolder(
  token:      string,
  parentId:   string | null,
  folderName: string,
): Promise<string> {
  const q = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false` +
    (parentId ? ` and '${parentId}' in parents` : '');

  const { data } = await axios.get<{ files: { id: string }[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000 },
  );

  if (data.files.length > 0) return data.files[0]!.id;

  const body = {
    name:     folderName,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId ? { parents: [parentId] } : {}),
  };
  const { data: created } = await axios.post<{ id: string }>(
    'https://www.googleapis.com/drive/v3/files',
    body,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000 },
  );
  return created.id;
}

async function uploadToDropbox(
  token:    string,
  content:  Buffer,
  path:     string,
): Promise<void> {
  await axios.post('https://content.dropboxapi.com/2/files/upload', content, {
    headers: {
      Authorization:   `Bearer ${token}`,
      'Content-Type':  'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false }),
    },
    timeout: 30_000,
  });
}

async function uploadToOneDrive(
  token:    string,
  content:  Buffer,
  path:     string,
): Promise<void> {
  await axios.put(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(path)}:/content`,
    content,
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      timeout: 30_000,
    },
  );
}

// ── Main processor ────────────────────────────────────────────────────────────

export const archiveSyncProcessor: Processor<CloudArchiveSyncJobData> = async (
  job: Job<CloudArchiveSyncJobData>,
) => {
  const { invoiceId, tenantId } = job.data;
  logger.log(`[archive#${job.id}] syncing invoice ${invoiceId} for tenant ${tenantId}`);

  // 1. Load invoice number from DB
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) {
    logger.warn(`Invoice ${invoiceId} not found — skipping archive sync`);
    return;
  }

  await job.updateProgress(10);

  // 2. Fetch PDF + XML from API (same pattern as email service)
  const authHeaders =
    NODE_ENV !== 'production'
      ? { 'x-dev-tenant-id': tenantId }
      : { Authorization: `Bearer ${process.env['WORKER_SERVICE_TOKEN'] ?? ''}` };

  const [pdfRes, ublRes] = await Promise.all([
    axios.get<ArrayBuffer>(`${APP_BASE_URL}/api/v1/invoices/${invoiceId}/pdf`, {
      responseType: 'arraybuffer', headers: authHeaders, timeout: 15_000,
    }),
    axios.get<string>(`${APP_BASE_URL}/api/v1/invoices/${invoiceId}/ubl`, {
      responseType: 'text', headers: authHeaders, timeout: 10_000,
    }),
  ]);

  const pdfBuffer = Buffer.from(pdfRes.data);
  const xmlBuffer = Buffer.from(ublRes.data, 'utf8');
  const baseName  = invoice.number; // e.g. INV-2026-00002

  await job.updateProgress(30);

  // 3. Load all active CloudArchive records for this tenant
  const archives = await prisma.cloudArchive.findMany({
    where: { tenantId, isActive: true },
  });

  if (archives.length === 0) {
    logger.log(`No active cloud archives for tenant ${tenantId} — skipping`);
    return;
  }

  const encKey     = process.env['ARCHIVE_ENCRYPTION_KEY'] ?? '0'.repeat(64);
  const now        = new Date();
  const yearFolder = String(now.getFullYear());
  const monthFolder = String(now.getMonth() + 1).padStart(2, '0');
  const successProviders: string[] = [];

  // 4. Upload to each provider
  for (const record of archives) {
    try {
      logger.log(`[archive#${job.id}] uploading to ${record.provider}`);
      const token = await getValidToken(record, encKey);

      if (record.provider === 'GOOGLE_DRIVE') {
        // Create /InvoiceArchive/YYYY/MM/ folder hierarchy
        const rootId  = await ensureGoogleDriveFolder(token, record.folderId ?? null, 'InvoiceArchive');
        const yearId  = await ensureGoogleDriveFolder(token, rootId, yearFolder);
        const monthId = await ensureGoogleDriveFolder(token, yearId, monthFolder);
        await uploadToGoogleDrive(token, pdfBuffer, 'application/pdf',           `${baseName}.pdf`, monthId);
        await uploadToGoogleDrive(token, xmlBuffer, 'application/xml',            `${baseName}.xml`, monthId);

      } else if (record.provider === 'DROPBOX') {
        const base = `${record.folderPath}/${yearFolder}/${monthFolder}`;
        await uploadToDropbox(token, pdfBuffer, `${base}/${baseName}.pdf`);
        await uploadToDropbox(token, xmlBuffer, `${base}/${baseName}.xml`);

      } else if (record.provider === 'ONEDRIVE') {
        const base = `${record.folderPath}/${yearFolder}/${monthFolder}`;
        await uploadToOneDrive(token, pdfBuffer, `${base}/${baseName}.pdf`);
        await uploadToOneDrive(token, xmlBuffer, `${base}/${baseName}.xml`);
      }

      // 5e. Update lastSyncAt
      await prisma.cloudArchive.update({
        where: { id: record.id },
        data:  { lastSyncAt: now },
      });
      successProviders.push(record.provider);
      logger.log(`[archive#${job.id}] ${record.provider} ✓`);

    } catch (err) {
      // 5f. Log error, continue other providers
      logger.error(`[archive#${job.id}] ${record.provider} FAILED: ${(err as Error).message}`);
    }
  }

  await job.updateProgress(95);

  // 5. Write AuditLog
  await prisma.auditLog.create({
    data: {
      tenantId,
      invoiceId,
      action:  'ARCHIVE_SYNC_COMPLETED',
      payload: { invoiceId, providers: successProviders, syncedAt: now.toISOString() },
    },
  });

  logger.log(`[archive#${job.id}] done — providers: [${successProviders.join(', ')}]`);
};
