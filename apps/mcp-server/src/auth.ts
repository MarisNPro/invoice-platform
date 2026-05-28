/**
 * API-key authentication for the MCP server.
 *
 * Keys are read from MCP_API_KEYS (a JSON object mapping key → orgId) **plus**
 * an optional single-key shortcut via MCP_DEV_KEY / MCP_DEV_ORG_ID.
 *
 * Keys that begin with "ro_" are read-only (list / get tools only).
 */

export interface AuthResult {
  orgId: string;
  isReadOnly: boolean;
}

/**
 * Validate the raw `Authorization` header value (e.g. "Bearer ro_abc123" or
 * just "ro_abc123") and return the associated org context, or null if invalid.
 */
export function validateApiKey(authHeader: string | undefined): AuthResult | null {
  if (!authHeader) return null;

  // Strip optional "Bearer " prefix
  const raw = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!raw) return null;

  // --- MCP_DEV_KEY shortcut (for local dev / docker compose) ----------------
  const devKey   = process.env.MCP_DEV_KEY   ?? '';
  const devOrgId = process.env.MCP_DEV_ORG_ID ?? '';
  if (devKey && raw === devKey && devOrgId) {
    return { orgId: devOrgId, isReadOnly: raw.startsWith('ro_') };
  }

  // --- MCP_API_KEYS JSON map: { "sk_...": "org-uuid", "ro_...": "org-uuid" } -
  const keysEnv = process.env.MCP_API_KEYS ?? '{}';
  let keysMap: Record<string, string> = {};
  try {
    keysMap = JSON.parse(keysEnv) as Record<string, string>;
  } catch {
    console.warn('[auth] MCP_API_KEYS is not valid JSON — ignoring');
  }

  const orgId = keysMap[raw];
  if (!orgId) return null;

  return { orgId, isReadOnly: raw.startsWith('ro_') };
}
