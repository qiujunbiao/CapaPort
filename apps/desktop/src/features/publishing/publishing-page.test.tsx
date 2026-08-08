import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PublishingPage } from './publishing-page';

describe('PublishingPage review actions', () => {
  const publication = {
    id: 'publication-a',
    organizationId: 'org-a',
    capabilityId: 'capability-a',
    sourceSpaceId: 'personal-a',
    sourceRevisionId: 'revision-a',
    targetSpaceId: 'organization-a',
    candidateDigest: 'a'.repeat(64),
    version: '1.0.0',
    status: 'in_review' as const,
    submittedByUserId: 'user-a',
    createdAt: '2026-08-08T00:00:00.000Z',
  };

  it('lets an organization manager approve an in-review publication with a reason', async () => {
    const onReview = vi.fn(async () => undefined);
    render(
      <PublishingPage
        publications={[publication]}
        capabilities={[]}
        spaces={[]}
        canReview
        online
        loadReviewContext={async () => ({
          details: { ...publication, reviews: [] },
          scan: { status: 'passed', findings: [] },
          diff: {
            fromVersionId: 'version-old',
            candidateDigest: publication.candidateDigest,
            added: [],
            modified: [],
            removed: [],
            recommendedChange: 'patch',
          },
        })}
        onReview={onReview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /capabili/ }));
    await screen.findByText('安全扫描');
    fireEvent.change(screen.getByLabelText('审核理由'), { target: { value: '管理员确认发布' } });
    fireEvent.click(screen.getByRole('button', { name: '通过审核' }));

    await waitFor(() => expect(onReview).toHaveBeenCalledWith('publication-a', 'approve', '管理员确认发布'));
  });

  it('loads scan and version-diff evidence before enabling a review decision', async () => {
    const loadReviewContext = vi.fn(async () => ({
      details: { ...publication, reviews: [] },
      scan: { status: 'passed', findings: [] },
      diff: {
        fromVersionId: 'version-old',
        candidateDigest: publication.candidateDigest,
        added: ['skills/new.md'],
        modified: ['README.md'],
        removed: [],
        recommendedChange: 'minor' as const,
      },
    }));
    render(
      <PublishingPage
        publications={[publication]}
        capabilities={[
          {
            id: 'capability-a',
            organizationId: 'org-a',
            spaceId: 'personal-a',
            slug: 'find-skills',
            name: 'find-skills',
            description: '',
            tags: [],
            compatibility: ['codex'],
            ownerUserId: 'user-a',
            status: 'active',
          },
        ]}
        spaces={[
          {
            id: 'organization-a',
            organizationId: 'org-a',
            type: 'organization',
            name: '组织空间',
            slug: 'organization',
            reviewPolicy: 'required',
            status: 'active',
          },
        ]}
        canReview
        online
        loadReviewContext={loadReviewContext}
        onReview={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /find-skills/ }));

    expect(await screen.findByText('安全扫描')).toBeInTheDocument();
    expect(screen.getByText(/新增 1/)).toBeInTheDocument();
    expect(screen.getByText(/skills\/new\.md/)).toBeInTheDocument();
    expect(loadReviewContext).toHaveBeenCalledWith('publication-a');
  });
});
