import { IsUUID } from 'class-validator';

export class ExtractDto {
  @IsUUID()
  fileId!: string;
}
