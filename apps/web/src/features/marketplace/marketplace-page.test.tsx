import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { webFixture } from '../../test/fixtures';
import { MarketplacePage } from './marketplace-page';

const capability = (name: string, hasPublishedVersion: boolean) => ({
  id: `capability-${name}`,
  organizationId: 'organization-a',
  spaceId: 'space-a',
  slug: name.toLowerCase(),
  name,
  description: '',
  tags: [],
  compatibility: ['codex'] as Array<'codex'>,
  ownerUserId: 'user-a',
  status: 'active' as const,
  hasPublishedVersion,
});

describe('MarketplacePage capability visibility', () => {
  it('shows only installable published capabilities', () => {
    render(
      <MarketplacePage
        client={webFixture()}
        capabilities={[capability('Published', true), capability('Pending', false)]}
        spaces={[
          {
            id: 'space-a',
            organizationId: 'organization-a',
            type: 'organization',
            name: 'Organization',
            slug: 'organization',
            reviewPolicy: 'required',
            status: 'active',
          },
        ]}
        canGovern
        currentUserId="user-a"
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });
});
