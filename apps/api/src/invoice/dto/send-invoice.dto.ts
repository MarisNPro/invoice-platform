import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendInvoiceDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['email'])
  channel!: 'email';

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;
}
