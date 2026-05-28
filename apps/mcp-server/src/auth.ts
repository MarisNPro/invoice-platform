/**
 * API-key authentication for the MCP server.
 *
 * Resolution order:
 *  1. MCP_DEV_KEY env shortcut (local dev / docker compose)
 *  2. MCP_API_KEYS JSON map { "sk_...": "org-uuid", "ro_...": "org-uuid" }
 *  3. ro_ prefixed keys → validated against the Invoice Platform DB
 *     via POST /api/v1/organisations/api-keys/validate
 *
 * Keys beginning with "ro_" are read-only (list / get tools only).
 * Customer-scoped keys carry an extra customerId that restricts list_invoices.
 */

import axios from 'axios';

const APP_BASE = (process.env['APP_BASE_URL'] ?? 'http://localhost:4000') + '/api/v1';

export interface AuthResult {
  orgId:       string;
  isReadOnly:  boolean;
  customerId?: string;  // set when key is scoped to a single buyer contact
}

/**
 * Validate the raw Authorization header and return the org context, or null.
 * Async because DB-backed ro_ keys require an HTTP lookup to the API.
 */
export async function validateApiKey(
  authHeader: string | undefined,
): Promise<AuthResult | null> {
  if (!authHeader) return null;

  const raw = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!raw) return null;

  // 1. MCP_DEV_KEY shortcut ──────────────────────────────────────────────────
  const devKey   = process.env['MCP_DEV_KEY']   ?? '';
  const devOrgId = process.env['MCP_DEV_ORG_ID'] ?? '';
  if (devKey && raw === devKey && devOrgId) {
    return { orgId: devOrgId, isReadOnly: raw.startsWith('ro_') };
  }

  // 2. MCP_API_KEYS env-var map ──────────────────────────────────────────────
  const keysEnv = process.env['MCP_API_KEYS'] ?? '{}';
  let keysMap: Record<string, string> = {};
  try {
    keysMap = JSON.parse(keysEnv) as Record<string, string>;
  } catch {
    console.warn('[auth] MCP_API_KEYS is not valid JSON — ignoring');
  }

  const mappedOrgId = keysMap[raw];
  if (mappedOrgId) {
    return { orgId: mappedOrgId, isReadOnly: raw.startsWith('ro_') };
  }

  // 3. DB-backed ro_ keys — validate via API ─────────────────────────────────
  if (raw.startsWith('ro_')) {
    try {
      const { data } = await axios.post<{
        valid: boolean;
        orgId?: string;
        customerId?: string;
      }>(
        `${APP_BASE}/organisations/api-keys/validate`,
        { key: raw },
        { timeout: 5_000 },
      );

      if (data.valid && data.orgId) {
        return {
          orgId:      data.orgId,
          isReadOnly: true,
          customerId: data.customerId,
        };
      }
    } catch (err) {
      console.warn('[auth] DB key validation failed:', (err as Error).message);
    }
  }

  return null;
}
