import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(UUID_RE, { message: 'customerId must be a UUID' })
  customerId?: string;
}
