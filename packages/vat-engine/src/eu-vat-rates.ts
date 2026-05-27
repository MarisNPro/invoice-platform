/**
 * Standard VAT rates by EU country (ISO 3166-1 alpha-2).
 * Source: European Commission — VAT rates applicable in EU member states, 2024.
 * Reduced rates not listed; use Prisma tax_rates for per-tenant configuration.
 */
export const EU_VAT_RATES: Record<string, number> = {
  AT: 0.20, BE: 0.21, BG: 0.20, CY: 0.19,
  CZ: 0.21, DE: 0.19, DK: 0.25, EE: 0.22,
  EL: 0.24, ES: 0.21, FI: 0.25, FR: 0.20,
  HR: 0.25, HU: 0.27, IE: 0.23, IT: 0.22,
  LT: 0.21, LU: 0.17, LV: 0.21, MT: 0.18,
  NL: 0.21, PL: 0.23, PT: 0.23, RO: 0.19,
  SE: 0.25, SI: 0.22, SK: 0.20,
};

export function getStandardRate(countryCode: string): number {
  return EU_VAT_RATES[countryCode.toUpperCase()] ?? 0;
}
