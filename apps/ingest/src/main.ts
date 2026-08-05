import { NestFactory } from '@nestjs/core';
import { IngestModule } from './ingest.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(IngestModule);
  await app.init();
}

void bootstrap();
