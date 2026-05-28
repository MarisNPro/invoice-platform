export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'VOID';
export type InvoiceType = 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
export type PaymentMethod = 'BANK_TRANSFER' | 'CREDIT_CARD' | 'DIRECT_DEBIT' | 'CASH' | 'OTHER';
export type CountryCode = 'FI' | 'EE' | 'LV' | 'LT' | string;
export interface Company {
    id: string;
    name: string;
    registrationNumber: string;
    vatNumber?: string;
    country: CountryCode;
    status: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
    address?: Address;
}
export interface Address {
    street?: string;
    city?: string;
    postalCode?: string;
    country: string;
}
export type UserRole = 'ADMIN' | 'ACCOUNTANT' | 'VIEWER';
export interface AuthUser {
    id: string;
    tenantId: string;
    email: string;
    name: string;
    role: UserRole;
}
export interface ApiResponse<T> {
    data: T;
    meta?: {
        total?: number;
        page?: number;
        pageSize?: number;
    };
}
export interface ApiError {
    statusCode: number;
    message: string;
    error?: string;
}
/**
 * EN 16931 tax category codes:
 *  S  = Standard rate
 *  Z  = Zero rated
 *  E  = Exempt
 *  AE = Reverse charge (VAT)
 *  K  = Intra-community supply (zero)
 *  G  = Export (zero)
 *  O  = Outside scope
 *  L  = IGIC (Canary Islands)
 *  M  = IPSI (Ceuta/Melilla)
 */
export type TaxCategoryCode = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O' | 'L' | 'M';
export interface TaxRate {
    id: string;
    name: string;
    rate: number;
    categoryCode: TaxCategoryCode;
}
export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'SEK' | 'NOK' | 'DKK' | 'CHF' | 'PLN' | 'CZK' | 'HUF' | 'RON' | 'BGN' | 'HRK' | 'RSD';
//# sourceMappingURL=index.d.ts.map