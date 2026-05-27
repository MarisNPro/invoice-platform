import {
  IsString,
  IsDateString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  Matches,
  Min,
  IsNotEmpty,
  Length,
  ArrayMinSize,
} from 'class-validator';

/** Accepts any canonical UUID (8-4-4-4-12 hex), including tombstone/nil UUIDs */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { Type } from 'class-transformer';

// ── Line DTO ─────────────────────────────────────────────────────────────────

export class CreateInvoiceLineBodyDto {
  /** Free-text item description (BT-153) */
  @IsString()
  @IsNotEmpty()
  itemName!: string;

  /** BT-129 invoiced quantity */
  @IsNumber()
  @Min(0)
  quantity!: number;

  /** BT-146 net unit price (before VAT) */
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  /** BT-152 VAT rate as a percentage, e.g. 21 for 21% */
  @IsNumber()
  @Min(0)
  vatRatePercent!: number;

  /** BT-130 unit of measure code (UN/CEFACT rec 20): HUR, DAY, PCS, ANN … */
  @IsString()
  @IsNotEmpty()
  unitCode!: string;
}

// ── Invoice DTO ───────────────────────────────────────────────────────────────

export class CreateInvoiceBodyDto {
  /** ID of the customer (Contact) that is the buyer (BG-4) */
  @Matches(UUID_RE, { message: 'customerId must be a UUID' })
  customerId!: string;

  /** ISO 4217 currency code (BT-5), e.g. "EUR" */
  @IsString()
  @Length(3, 3)
  currency!: string;

  /** BCP 47 language tag for the invoice document, e.g. "en" or "lv" */
  @IsOptional()
  @IsString()
  @Length(2, 5)
  language?: string;

  /** BT-2 invoice issue date (YYYY-MM-DD) */
  @IsDateString()
  issueDate!: string;

  /** BT-9 payment due date (YYYY-MM-DD) */
  @IsDateString()
  dueDate!: string;

  /** BG-25 invoice lines — at least one required */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineBodyDto)
  lines!: CreateInvoiceLineBodyDto[];

  /** BT-22 invoice note */
  @IsOptional()
  @IsString()
  note?: string;

  /** BT-20 payment terms note */
  @IsOptional()
  @IsString()
  paymentTermsNote?: string;
}
