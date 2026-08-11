import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomePage } from './home-page';

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

describe('HomePage capability visibility', () => {
  it('counts and lists only installable published capabilities', () => {
    render(
      <HomePage
        agents={[]}
        capabilities={[capability('Published', true), capability('Pending', false)]}
        online
        loading={false}
        onDiscover={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText('可用能力包').previousElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  it('names all supported clients in the empty state', () => {
    render(
      <HomePage
        agents={[]}
        capabilities={[]}
        online
        loading={false}
        onDiscover={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText(/WorkBuddy/)).toHaveTextContent('千问 Work');
  });
});
