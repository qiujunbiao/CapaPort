import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('CapaPort API')
    .setDescription('Cloud API for governed capability discovery, publishing, installation, and organization sharing.')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-organization-id' }, 'organization')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'idempotency-key' }, 'idempotency')
    .build();
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey
        .replace(/Controller$/, '')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toLowerCase()}_${methodKey}`,
  });
}

export function registerOpenApi(app: INestApplication): OpenAPIObject {
  const document = createOpenApiDocument(app);
  app.getHttpAdapter().get('/api/v1/openapi.json', (_request: unknown, response: { send(value: unknown): void }) => {
    response.send(document);
  });
  return document;
}
