import type { PublicationStatus, VersionStatus } from '@agentdoor/contracts/publications';
import { AppError } from '../../platform/errors/app-error.js';

export type PublicationAction = 'approve' | 'request_changes' | 'reject' | 'withdraw';
export type VersionAction = 'deprecate' | 'withdraw' | 'archive';

const publicationTransitions: Partial<
  Record<PublicationStatus, Partial<Record<PublicationAction, PublicationStatus>>>
> = {
  in_review: {
    approve: 'published',
    request_changes: 'changes_requested',
    reject: 'rejected',
    withdraw: 'withdrawn',
  },
  published: { withdraw: 'withdrawn' },
};

const versionTransitions: Partial<Record<VersionStatus, Partial<Record<VersionAction, VersionStatus>>>> = {
  published: { deprecate: 'deprecated', withdraw: 'withdrawn' },
  deprecated: { withdraw: 'withdrawn', archive: 'archived' },
  withdrawn: { archive: 'archived' },
};

export function transitionPublication(state: PublicationStatus, action: PublicationAction): PublicationStatus {
  const next = publicationTransitions[state]?.[action];
  if (!next) throw new AppError('PUBLICATION_TRANSITION_INVALID', 'Publication transition is not allowed.', 409);
  return next;
}

export function transitionVersion(state: VersionStatus, action: VersionAction): VersionStatus {
  const next = versionTransitions[state]?.[action];
  if (!next) throw new AppError('VERSION_TRANSITION_INVALID', 'Version transition is not allowed.', 409);
  return next;
}
