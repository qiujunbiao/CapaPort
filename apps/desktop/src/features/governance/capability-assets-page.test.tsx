import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityAssetsPage } from './capability-assets-page';

describe('CapabilityAssetsPage', () => {
  it('edits governed metadata and manages immutable versions', async () => {
    const onUpdate = vi.fn(async () => undefined);
    const onTransition = vi.fn(async () => undefined);
    render(
      <CapabilityAssetsPage
        capabilities={[
          {
            id: 'capability-a',
            organizationId: 'org-a',
            spaceId: 'space-a',
            slug: 'find-skills',
            name: 'find-skills',
            description: 'Find skills',
            tags: ['search'],
            compatibility: ['codex'],
            ownerUserId: 'user-a',
            status: 'active',
            hasPublishedVersion: true,
          },
        ]}
        spaces={[]}
        online
        canManage
        loadVersions={async () => [
          {
            id: 'version-a',
            organizationId: 'org-a',
            capabilityId: 'capability-a',
            spaceId: 'space-a',
            version: '1.0.0',
            contentDigest: 'a'.repeat(64),
            status: 'published',
            publishedAt: '2026-08-08T00:00:00.000Z',
          },
          {
            id: 'version-b',
            organizationId: 'org-a',
            capabilityId: 'capability-a',
            spaceId: 'space-a',
            version: '0.9.0',
            contentDigest: 'b'.repeat(64),
            status: 'deprecated',
            publishedAt: '2026-08-01T00:00:00.000Z',
          },
        ]}
        loadDiff={async () => ({
          fromVersionId: 'version-b',
          toVersionId: 'version-a',
          added: ['SKILL.md'],
          modified: [],
          removed: [],
          recommendedChange: 'minor',
        })}
        onUpdate={onUpdate}
        onTransition={onTransition}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /find-skills/ }));
    expect(screen.getByRole('checkbox', { name: 'WorkBuddy' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '千问 Work（QwenWork）' })).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('能力名称'), { target: { value: 'Skill Finder' } });
    fireEvent.click(screen.getByRole('button', { name: '保存元数据' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('capability-a', expect.objectContaining({ name: 'Skill Finder' })),
    );

    fireEvent.click(screen.getByRole('button', { name: '比较版本' }));
    expect(await screen.findByText(/新增 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '弃用版本 1.0.0' }));
    await waitFor(() => expect(onTransition).toHaveBeenCalledWith('capability-a', 'version-a', 'deprecate'));
  });

  it('lets a space contributor edit metadata without granting version governance', async () => {
    render(
      <CapabilityAssetsPage
        capabilities={[
          {
            id: 'capability-a',
            organizationId: 'org-a',
            spaceId: 'space-a',
            slug: 'find-skills',
            name: 'find-skills',
            description: '',
            tags: [],
            compatibility: ['codex'],
            ownerUserId: 'user-a',
            status: 'active',
            hasPublishedVersion: true,
          },
        ]}
        spaces={[
          {
            id: 'space-a',
            organizationId: 'org-a',
            type: 'team',
            name: 'Team',
            slug: 'team',
            reviewPolicy: 'required',
            status: 'active',
            role: 'contributor',
          },
        ]}
        online
        canManage={false}
        loadVersions={async () => [
          {
            id: 'version-a',
            organizationId: 'org-a',
            capabilityId: 'capability-a',
            spaceId: 'space-a',
            version: '1.0.0',
            contentDigest: 'a'.repeat(64),
            status: 'published',
            publishedAt: '2026-08-08T00:00:00.000Z',
          },
        ]}
        loadDiff={vi.fn()}
        onUpdate={vi.fn()}
        onTransition={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /find-skills/ }));
    expect(await screen.findByRole('button', { name: '保存元数据' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '弃用版本 1.0.0' })).toBeDisabled();
  });
});
