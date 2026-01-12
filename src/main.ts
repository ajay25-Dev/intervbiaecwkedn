import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './env';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  loadEnv();
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Configure body parser with increased limits for large job descriptions
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

  // Configure CORS - more restrictive for production
  const corsOptions = {
    origin:
      process.env.NODE_ENV === 'production'
        ? process.env.FRONTEND_URL?.split(',') || false
        : [
            'http://localhost:3003',
            'http://localhost:3000',
            'http://localhost:3004',
          ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-User-Id'],
  };

  app.enableCors(corsOptions);

  // Set global prefix for API routes
  app.setGlobalPrefix('api', {
    exclude: ['health', 'v1/*'], // Exclude health checks and all v1 routes from prefix
  });

  const port = process.env.PORT || 8080;

  await app.listen(port, '0.0.0.0'); // Bind to all interfaces for Railway

  // console.log(`🚀 Server running on port ${port}`);
  // console.log(`📊 Health check available at /v1/health`);
  // console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap().catch((err) => {
  console.error('❌ Error starting server:', err);
  process.exit(1);
});
