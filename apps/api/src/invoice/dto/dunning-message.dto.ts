import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class DunningMessageDto {
  @IsString()
  @IsNotEmpty()
  language!: string;

  @IsIn(['email', 'whatsapp'])
  channel!: 'email' | 'whatsapp';
}
