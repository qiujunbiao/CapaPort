import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../../platform/database/database.service.js';
import { IdentityRepository } from './identity.repository.js';

describe('IdentityRepository password recovery', () => {
  it('consumes the challenge, changes the password, and revokes sessions in one transaction', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [
          {
            purpose: 'recover_password',
            code_digest: 'digest',
            user_id: 'user-1',
            expires_at: new Date('2030-01-01T00:00:00.000Z'),
            consumed_at: null,
            attempts: 0,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const client = { query, release: vi.fn() };
    const database = { pool: { connect: vi.fn().mockResolvedValue(client) } } as unknown as DatabaseService;
    const repository = new IdentityRepository(database);

    await repository.completePasswordRecovery({
      challengeId: 'challenge-1',
      codeDigest: 'digest',
      userId: 'user-1',
      passwordHash: 'argon2id-hash',
      now: new Date('2029-01-01T00:00:00.000Z'),
    });

    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'BEGIN',
      'SELECT * FROM',
      'UPDATE verification_challenges SET',
      'UPDATE users SET',
      'UPDATE sessions SET',
      'UPDATE refresh_tokens SET',
      'COMMIT',
    ]);
    expect(query.mock.calls[2]?.[1]).toEqual(['challenge-1', expect.any(Date)]);
    expect(query.mock.calls[3]?.[1]).toEqual(['user-1', 'argon2id-hash', expect.any(Date)]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('does not change the password when the challenge changed after authorization', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [
          {
            purpose: 'recover_password',
            code_digest: 'different-digest',
            user_id: 'user-1',
            expires_at: new Date('2030-01-01T00:00:00.000Z'),
            consumed_at: null,
            attempts: 0,
          },
        ],
      })
      .mockResolvedValue(undefined);
    const client = { query, release: vi.fn() };
    const database = { pool: { connect: vi.fn().mockResolvedValue(client) } } as unknown as DatabaseService;
    const repository = new IdentityRepository(database);

    await expect(
      repository.completePasswordRecovery({
        challengeId: 'challenge-1',
        codeDigest: 'digest',
        userId: 'user-1',
        passwordHash: 'argon2id-hash',
        now: new Date('2029-01-01T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'AUTH_VERIFICATION_INVALID' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE users'))).toBe(false);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  });
});
