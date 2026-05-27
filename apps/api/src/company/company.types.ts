export type CountryCode = 'FI' | 'EE' | 'LV' | 'LT';

/** Normalised result returned to API consumers */
export interface CompanyResult {
  id:         string;
  country:    string;
  name:       string;
  regNumber:  string;
  vatNumber?: string;
  legalForm?: string;
  address?:   string;
  status:     string;
  source:     string;
}

// ── PRH YTJ v3 (Finland) ─────────────────────────────────────────────────

export interface PrhV3Company {
  businessId: { value: string; registrationDate?: string };
  names: Array<{
    name:              string;
    type:              string; // "1" = trade name, "3" = parallel/auxiliary name
    registrationDate?: string;
    endDate?:          string; // absent/null = currently active
  }>;
  companyForms?: Array<{
    type:         string;
    descriptions: Array<{ languageCode: string; description: string }>;
    endDate?:     string;
  }>;
  addresses?: Array<{
    type:       number; // 1 = visiting, 2 = postal
    street?:    string;
    postCode?:  string;
    postOffices?: Array<{ city: string; languageCode: string }>;
    endDate?:   string;
  }>;
  endDate?: string; // present when company is dissolved
  status?:  string;
  registrationDate?: string;
}

export interface PrhV3Response {
  totalResults?: number;
  companies?:    PrhV3Company[];
}

// ── Äriregister autocomplete (Estonia) ───────────────────────────────────

export interface AriregisterAutocompleteResponse {
  status: string;
  data:   AriregisterAutocompleteItem[];
}

export interface AriregisterAutocompleteItem {
  company_id:    number;
  reg_code:      number;
  name:          string;
  historical_names?: string[];
  status:        string; // "R" = active
  legal_address?: string;
  zip_code?:     string | null;
  legal_form?:   string;
  url?:          string;
}

// ── Elasticsearch company document (LV / LT) ─────────────────────────────

export interface CompanyDocument {
  id:          string;
  country:     string;
  name:        string;
  regNumber:   string;
  vatNumber?:  string;
  legalForm?:  string;
  address?:    string;
  status:      string;
  source:      string;
}
