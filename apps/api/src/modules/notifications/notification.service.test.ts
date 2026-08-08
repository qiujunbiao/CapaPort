import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../platform/errors/app-error.js';
import { type NotificationDataStore, NotificationService } from './notification.service.js';

function repository(retried = true): NotificationDataStore {
  return {
    list: vi.fn(),
    markRead: vi.fn(),
    deadLetters: vi.fn(),
    retryDeadLetter: vi.fn().mockResolvedValue(retried),
  };
}

describe('NotificationService operations recovery', () => {
  it('allows administrators to retry a tenant-scoped dead letter', async () => {
    const data = repository();
    const service = new NotificationService(data);
    await expect(
      service.retryDeadLetter(
        { organizationId: 'org-1', membershipId: 'member-1', organizationRole: 'admin' },
        'operation',
        'job-1',
      ),
    ).resolves.toEqual({ accepted: true });
    expect(data.retryDeadLetter).toHaveBeenCalledWith('org-1', 'operation', 'job-1');
  });

  it('rejects members and undisclosed job identifiers', async () => {
    const service = new NotificationService(repository(false));
    await expect(
      service.retryDeadLetter(
        { organizationId: 'org-1', membershipId: 'member-1', organizationRole: 'member' },
        'outbox',
        'job-1',
      ),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' } satisfies Partial<AppError>);
    const admin = new NotificationService(repository(false));
    await expect(
      admin.retryDeadLetter(
        { organizationId: 'org-1', membershipId: 'member-1', organizationRole: 'owner' },
        'delivery',
        'unknown',
      ),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' } satisfies Partial<AppError>);
  });
});
