import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }));
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApplication(app, config);
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

void main();
