import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: process.env.NODE_ENV !== 'production',
      trustProxy: true,
    }),
  );

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3001);
  const prefix = config.get<string>('API_GLOBAL_PREFIX', 'api/v1');
  const corsOrigins = config.get<string>('CORS_ORIGINS', 'http://localhost:3000').split(',');

  app.setGlobalPrefix(prefix);

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 API listening on http://0.0.0.0:${port}/${prefix}`);
  logger.log(`📋 Health: http://0.0.0.0:${port}/${prefix}/health`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
