import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ConfirmLineDto {
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
  @Max(100)
  vatRatePercent!: number;

  @IsString()
  @IsNotEmpty()
  unitCode!: string;
}

export class ConfirmDto {
  /** Override with a known Contact UUID — skips name lookup */
  @IsOptional()
  @IsUUID()
  customerId?: string;

  /** Customer name — used to find/create a contact when customerId is absent */
  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerVatNumber?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  /** Corrected line items from the review form; falls back to extractedData if absent */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmLineDto)
  lines?: ConfirmLineDto[];

  @IsOptional()
  @IsString()
  note?: string;
}
