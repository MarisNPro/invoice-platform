import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ParseController } from './parse.controller';

@Module({
  controllers: [ParseController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
