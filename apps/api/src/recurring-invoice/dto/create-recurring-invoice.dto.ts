import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Accepts any canonical UUID (8-4-4-4-12 hex), including tombstone/nil UUIDs */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RecurringInvoiceLineDto {
  @IsString()
  @IsNotEmpty()
  itemName!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsNumber()
  @Min(0)
  vatRatePercent!: number;

  @IsString()
  @IsNotEmpty()
  unitCode!: string;
}

export class CreateRecurringInvoiceDto {
  @Matches(UUID_RE)
  customerId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecurringInvoiceLineDto)
  templateLines!: RecurringInvoiceLineDto[];

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsString()
  @Length(2, 5)
  language?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @IsPositive()
  intervalDays!: number;

  @IsDateString()
  nextRunAt!: string;

  @IsOptional()
  @IsBoolean()
  autoSend?: boolean;
}
