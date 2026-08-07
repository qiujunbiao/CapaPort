import { describe, expect, it } from 'vitest';
import { IdentityModule } from '../identity/identity.module.js';
import { AccessModule } from './access.module.js';

describe('AccessModule dependency graph', () => {
  it('imports the identity providers required by AuthGuard', () => {
    const imports = Reflect.getMetadata('imports', AccessModule) as unknown[];
    expect(imports).toContain(IdentityModule);
  });
});
