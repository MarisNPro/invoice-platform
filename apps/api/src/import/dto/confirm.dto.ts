import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class ConfirmDto {
  /** Override the resolved customerId (UUID of existing Contact) */
  @IsOptional()
  @IsUUID()
  customerId?: string;

  /** Override the extracted currency (ISO 4217) */
  @IsOptional()
  @IsString()
  currency?: string;

  /** Override issue date (YYYY-MM-DD) */
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  /** Override due date (YYYY-MM-DD) */
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
