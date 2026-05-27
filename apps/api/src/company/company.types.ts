export type CountryCode = 'FI' | 'EE' | 'LV' | 'LT';

export interface CompanyResult {
  /** Source-specific identifier */
  id: string;
  name: string;
  /** National business registration number */
  registrationNumber: string;
  vatNumber?: string;
  country: CountryCode;
  status: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  address?: {
    street?: string;
    city?: string;
    postalCode?: string;
    country: string;
  };
  /** ISO 8601 */
  registeredAt?: string;
}

// ── PRH (Finland) raw shape ────────────────────────────────────────────────

export interface PrhCompany {
  businessId: string;
  name: string;
  registrationDate?: string;
  companyForm?: string;
  detailsUri?: string;
  businessLine?: { name: string; language: string }[];
  addresses?: Array<{
    type: number;
    street?: string;
    postCode?: string;
    city?: string;
    country?: string;
  }>;
}

export interface PrhSearchResponse {
  results: PrhCompany[];
  totalResults: number;
}

// ── Äriregister (Estonia) raw shape ───────────────────────────────────────

export interface AriregisterSuggestion {
  ariregistriKood: string;   // registration code
  nimi: string;              // name
  aadress?: string;
  staatus?: string;
}

// ── Elasticsearch company document ────────────────────────────────────────

export interface CompanyDocument {
  id: string;
  name: string;
  nameLower: string;          // for sorting
  registrationNumber: string;
  vatNumber?: string;
  country: CountryCode;
  status: string;
  street?: string;
  city?: string;
  postalCode?: string;
  registeredAt?: string;
  syncedAt: string;
}
