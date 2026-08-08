import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LibraryPage } from './library-page';

describe('LibraryPage publication visibility', () => {
  it('shows only capabilities that have an installable published version', () => {
    render(
      <LibraryPage
        capabilities={[
          {
            id: 'published',
            organizationId: 'org-a',
            spaceId: 'space-org',
            slug: 'published-skill',
            name: '已发布能力',
            description: '',
            tags: [],
            compatibility: ['codex'],
            ownerUserId: 'user-a',
            status: 'active',
            hasPublishedVersion: true,
          },
          {
            id: 'pending',
            organizationId: 'org-a',
            spaceId: 'space-org',
            slug: 'pending-skill',
            name: '待审核能力',
            description: '',
            tags: [],
            compatibility: ['codex'],
            ownerUserId: 'user-a',
            status: 'active',
            hasPublishedVersion: false,
          },
        ]}
        spaces={[]}
        installations={[]}
        updateChecks={{}}
        online
        onInstall={vi.fn()}
        onUninstall={vi.fn()}
      />,
    );

    expect(screen.getByText('已发布能力')).toBeInTheDocument();
    expect(screen.queryByText('待审核能力')).not.toBeInTheDocument();
  });
});
