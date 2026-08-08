import { buildArchive } from '@agentdoor/capability-kit';
import { describe, expect, it, vi } from 'vitest';
import { guardedUpload, scanArchiveBeforeUpload } from './client-scan';

const encode = (value: string) => new TextEncoder().encode(value);

describe('desktop pre-upload security gate', () => {
  it('does not invoke the cloud upload when a blocking finding exists', async () => {
    const archive = buildArchive([{ path: 'README.md', content: encode('-----BEGIN PRIVATE KEY-----') }]);
    const upload = vi.fn();
    const result = await guardedUpload({ archive, confirmed: false, upload });
    expect(result.report.blocked).toBe(true);
    expect(result.uploaded).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it('requires local confirmation for medium findings before invoking upload', async () => {
    const archive = buildArchive([{ path: 'context/contact.md', content: encode('owner@example.com') }]);
    const report = await scanArchiveBeforeUpload(archive);
    expect(report).toMatchObject({ blocked: false, requiresConfirmation: true });
    const upload = vi.fn().mockResolvedValue('uploaded');
    await expect(guardedUpload({ archive, confirmed: false, upload })).resolves.toMatchObject({ uploaded: false });
    await expect(guardedUpload({ archive, confirmed: true, upload })).resolves.toMatchObject({
      uploaded: true,
      value: 'uploaded',
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
