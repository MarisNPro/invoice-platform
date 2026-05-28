/**
 * Thin axios wrapper that forwards every request to the invoice-platform API
 * with the correct tenant header injected.
 */

import axios from 'axios';
import type { AxiosInstance } from 'axios';

export const APP_BASE =
  (process.env.APP_BASE_URL ?? 'http://localhost:4000') + '/api/v1';

/**
 * Create an axios instance pre-configured for the given org / tenant.
 *
 * In development the API uses the `x-dev-tenant-id` bypass header.
 * In production this would be replaced by a service-account JWT.
 */
export function makeApiClient(orgId: string): AxiosInstance {
  return axios.create({
    baseURL: APP_BASE,
    headers: {
      'Content-Type': 'application/json',
      // Dev bypass — maps directly to tenantId in the API
      'x-dev-tenant-id': orgId,
    },
    timeout: 15_000,
  });
}
