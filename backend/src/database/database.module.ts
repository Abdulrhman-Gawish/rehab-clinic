import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { buildTypeOrmOptions } from './typeorm.options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        ...buildTypeOrmOptions({
          DB_HOST: config.get('DB_HOST', { infer: true }),
          DB_PORT: config.get('DB_PORT', { infer: true }),
          DB_USERNAME: config.get('DB_USERNAME', { infer: true }),
          DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
          DB_DATABASE: config.get('DB_DATABASE', { infer: true }),
          DB_LOGGING: config.get('DB_LOGGING', { infer: true }),
        }),
        // Entities are registered by each module via TypeOrmModule.forFeature.
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
