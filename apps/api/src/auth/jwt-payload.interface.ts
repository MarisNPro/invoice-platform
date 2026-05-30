/**
 * Claims extracted from a Keycloak-issued JWT.
 * Keycloak puts roles in realm_access.roles and resource_access[client].roles.
 */
export interface JwtPayload {
  /** Keycloak user UUID */
  sub: string;
  /** Token issue time */
  iat: number;
  /** Token expiry */
  exp: number;
  /** Audience (client_id) */
  aud: string | string[];
  /** Keycloak realm */
  iss: string;

  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;

  /** Realm-level roles */
  realm_access?: { roles: string[] };
  /** Client-level roles, keyed by client_id */
  resource_access?: Record<string, { roles: string[] }>;

  /** Custom claim: tenant ID injected by Keycloak mapper */
  tenant_id?: string;

  /**
   * Supabase Auth: server-controlled, client-IMMUTABLE claim. tenant_id and role
   * MUST be read only from here — never from user_metadata, which the client can
   * edit via supabase.auth.updateUser(). This is the multi-tenant security boundary.
   */
  app_metadata?: { tenant_id?: string; role?: string };

  /** Which provider/path authenticated this request (observability only). */
  auth_source?: 'keycloak' | 'supabase' | 'dev';
}
