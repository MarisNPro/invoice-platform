import { IsDateString, IsIn, IsInt, IsOptional } from 'class-validator';

const VALID_TIERS = ['FREE', 'STARTER', 'BUSINESS', 'PROFESSIONAL'];

export class UpdatePlanDto {
  @IsOptional()
  @IsIn(VALID_TIERS)
  planTier?: string;

  @IsOptional()
  @IsInt()
  monthlyInvoiceLimit?: number;

  @IsOptional()
  @IsInt()
  monthlyAiCallLimit?: number;

  @IsOptional()
  @IsInt()
  monthlyAiSpendLimit?: number;

  @IsOptional()
  @IsDateString()
  planExpiresAt?: string;
}
