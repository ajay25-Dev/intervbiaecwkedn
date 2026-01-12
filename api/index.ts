// api/index.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

let expressHandler: any;

async function bootstrap() {
  const app = await NestFactory.create(AppModule); // uses Express by default
  // If you set a global prefix locally, uncomment and match routes below:
  // app.setGlobalPrefix('api');
  await app.init();
  return app.getHttpAdapter().getInstance(); // <- Express instance (req, res) handler
}

// Vercel Node runtime handler (req, res)
export default async function handler(req: any, res: any) {
  expressHandler = expressHandler || (await bootstrap());
  return expressHandler(req, res);
}
