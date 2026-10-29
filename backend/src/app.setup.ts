import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { createValidationPipe } from './common/pipes/validation.pipe.js';
import type { EnvironmentVariables } from './config/env.validation.js';

export const API_PREFIX = 'api/v1';
export const SWAGGER_PATH = 'api/docs';

// Everything that must be identical in main.ts and in e2e tests.
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (config.get('TRUST_PROXY', { infer: true })) {
    app.set('trust proxy', 1);
  }

  const origins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length) {
    app.enableCors({ origin: origins });
  }

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    setupSwagger(app);
  }
}

function setupSwagger(app: NestExpressApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Rehab Clinic API')
      .setDescription(
        'Clinic management backend. All routes require a bearer access token unless marked public.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
