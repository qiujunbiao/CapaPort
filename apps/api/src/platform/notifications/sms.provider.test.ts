import { describe, expect, it, vi } from 'vitest';
import { HttpSmsProvider, SmsDeliveryError } from './sms.provider.js';

describe('HTTP SMS provider', () => {
  const config = {
    endpoint: 'https://sms.example.com/v1/messages',
    token: 'top-secret-provider-token',
    sender: 'CapaPort',
    timeoutMs: 2_000,
  };

  it('validates E.164 and sends the provider contract with an idempotency key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const provider = new HttpSmsProvider(config, fetcher);
    await provider.send({
      to: '+8613800138000',
      template: 'identity_verification',
      variables: { code: '123456', expiresInMinutes: '10' },
      idempotencyKey: 'challenge-a',
    });
    expect(fetcher).toHaveBeenCalledWith(
      config.endpoint,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: `Bearer ${config.token}`,
          'idempotency-key': 'challenge-a',
        }),
        body: JSON.stringify({
          sender: 'CapaPort',
          to: '+8613800138000',
          template: 'identity_verification',
          variables: { code: '123456', expiresInMinutes: '10' },
        }),
      }),
    );
    await expect(
      provider.send({ to: '13800138000', template: 'identity_verification', variables: {}, idempotencyKey: 'bad' }),
    ).rejects.toMatchObject({ code: 'SMS_TARGET_INVALID', retryable: false });
  });

  it.each([
    [429, true],
    [503, true],
    [400, false],
  ])('classifies status %s without leaking credentials or recipients', async (status, retryable) => {
    const provider = new HttpSmsProvider(
      config,
      vi.fn().mockResolvedValue(new Response('provider details', { status })),
    );
    const error = await provider
      .send({ to: '+8613800138000', template: 'organization_invitation', variables: {}, idempotencyKey: 'invite-a' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SmsDeliveryError);
    expect(error).toMatchObject({ code: `SMS_PROVIDER_${status}`, retryable });
    expect(JSON.stringify(error)).not.toContain(config.token);
    expect(JSON.stringify(error)).not.toContain('+8613800138000');
  });

  it('classifies timeout/network failures as retryable and keeps the error redacted', async () => {
    const provider = new HttpSmsProvider(config, vi.fn().mockRejectedValue(new Error('socket leaked-target')));
    await expect(
      provider.send({ to: '+8613800138000', template: 'notification', variables: {}, idempotencyKey: 'event-a' }),
    ).rejects.toMatchObject({ code: 'SMS_PROVIDER_UNAVAILABLE', retryable: true });
  });
});
