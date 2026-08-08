import { describe, expect, it } from 'vitest';
import { RecentAuthGuard } from '../../platform/security/recent-auth.guard.js';
import { AuthController } from '../identity/auth.controller.js';
import { OrganizationController } from './organization.controller.js';

const guardsMetadataKey = '__guards__';

function guards(method: (...arguments_: never[]) => unknown): unknown[] {
  return Reflect.getMetadata(guardsMetadataKey, method) ?? [];
}

describe('lifecycle route security', () => {
  it.each([
    OrganizationController.prototype.close,
    OrganizationController.prototype.cancelClosure,
    OrganizationController.prototype.export,
    OrganizationController.prototype.transferOwnership,
    AuthController.prototype.exportAccount,
    AuthController.prototype.requestAccountDeletion,
    AuthController.prototype.cancelAccountDeletion,
  ])('requires recent authentication for %s', (method) => {
    expect(guards(method)).toContain(RecentAuthGuard);
  });
});
