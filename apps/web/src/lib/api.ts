const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const DEV_TENANT = process.env.NEXT_PUBLIC_DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';

/**
 * Auth header for API calls. Prefers the Supabase access token (Bearer); falls
 * back to the x-dev-tenant-id bypass in non-production for local dev. The
 * Supabase client is imported dynamically + window-guarded so this module stays
 * usable from any context without crossing the server/client boundary.
 */
async function authHeaders(): Promise<Record<string, string>> {
  if (typeof window !== 'undefined') {
    try {
      const { getSupabaseBrowser } = await import('./supabase/client');
      const { data } = await getSupabaseBrowser().auth.getSession();
      if (data.session) {
        return { Authorization: `Bearer ${data.session.access_token}` };
      }
    } catch {
      // Supabase not configured / no session — fall through to dev fallback.
    }
  }
  return process.env.NODE_ENV !== 'production' ? { 'x-dev-tenant-id': DEV_TENANT } : {};
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...(await authHeaders()) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiGetBlob(path: string): Promise<Blob> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...(await authHeaders()) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.blob();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg: string;
    try { msg = JSON.parse(text)?.message ?? text; } catch { msg = text; }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Typed response shapes ─────────────────────────────────────────────────────

export interface ContactResult {
  id: string;
  name: string;
  vatNumber?: string;
  businessId?: string;
  country: string;
  email?: string;
  addresses: Array<{
    street: string;
    city: string;
    postalCode: string;
    country: string;
    isDefault: boolean;
  }>;
}

export interface CompanySearchResult {
  id: string;
  country: string;
  name: string;
  regNumber: string;
  vatNumber?: string;
  legalForm?: string;
  address?: string;
  status: string;
  source: string;
}

export interface CreatedInvoice {
  id: string;
  number: string;
  status: string;
  total: number;
  currencyCode: string;
}

// ── Customers ─────────────────────────────────────────────────────────────────

export interface CustomerAddress {
  street: string; city: string; postalCode: string; country: string; isDefault: boolean;
}

export interface CustomerListItem {
  id:              string;
  name:            string;
  vatNumber:       string | null;
  businessId:      string | null;
  country:         string;
  email:           string | null;
  phone:           string | null;
  address:         CustomerAddress | null;
  invoiceCount:    number;
  totalInvoiced:   number;
  lastInvoiceDate: string | null;
}

// ── Invoices ──────────────────────────────────────────────────────────────────

export interface InvoiceListItem {
  id:          string;
  number:      string;
  status:      string;
  currencyCode: string;
  total:       number;
  issuedAt:    string;
  dueAt:       string;
  createdAt:   string;
  buyer:       { id: string; name: string; country: string };
  seller:      { id: string; name: string };
}

export interface InvoiceListResponse {
  data: InvoiceListItem[];
  meta: { page: number; limit: number; total: number; pages: number };
}

// ── Import pipeline ───────────────────────────────────────────────────────────

export interface ImportLine {
  itemName: string;
  quantity: number;
  unitPrice: number;
  vatRatePercent: number;
  unitCode: string;
}

export interface ImportConfidence {
  overall:  number;
  customer: number;
  amounts:  number;
  dates:    number;
  vatRate:  number;
}

export interface ImportExtractedData {
  customerName?:      string;
  customerVatNumber?: string;
  currency:           string;
  issueDate:          string;
  dueDate:            string;
  lines:              ImportLine[];
  note?:              string;
  confidence:         ImportConfidence;
}

export interface ImportRecord {
  id:            string;
  fileName:      string;
  status:        string;
  createdAt:     string;
  extractedData: ImportExtractedData | null;
  needsReview:   boolean;
}

export interface ImportListItem {
  id:                     string;
  fileName:               string;
  status:                 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt:              string;
  completedAt:            string | null;
  confidencePct:          number | null;
  confirmedInvoiceNumber: string | null;
}

export interface ConfirmResult {
  importId:      string;
  invoiceId:     string;
  invoiceNumber: string;
  status:        string;
  total:         number;
  currency:      string;
}

// ── AI parse response ─────────────────────────────────────────────────────────

export interface ParsedInvoiceLine {
  itemName: string;
  quantity: number;
  unitPrice: number;
  vatRatePercent: number;
  unitCode: string;
}

export interface ParsedInvoiceResponse {
  parsed: {
    customerName?: string;
    currency: string;
    issueDate: string;
    dueDate: string;
    lines: ParsedInvoiceLine[];
    note?: string;
    confidence: {
      overall: number;
      customer: number;
      amounts: number;
      dates: number;
      vatRate: number;
    };
  };
  missingRequiredFields: string[];
  notes: string[];
}
