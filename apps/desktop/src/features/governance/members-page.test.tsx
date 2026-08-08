import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MembersPage } from './members-page';

describe('MembersPage', () => {
  it('invites members and exposes role and removal management', async () => {
    const onInvite = vi.fn(async () => undefined);
    const onChangeRole = vi.fn(async () => undefined);
    const onRemove = vi.fn(async () => undefined);
    render(
      <MembersPage
        online
        members={[
          {
            id: 'member-a',
            userId: 'user-a',
            displayName: 'Rocky',
            role: 'member',
            status: 'active',
            joinedAt: '2026-08-08T00:00:00.000Z',
          },
        ]}
        invitations={[
          {
            id: 'invitation-pending',
            kind: 'email',
            target: 'pending@example.com',
            role: 'member',
            expiresAt: '2026-08-10T00:00:00.000Z',
            acceptedAt: null,
            revokedAt: null,
            createdAt: '2026-08-08T00:00:00.000Z',
          },
          {
            id: 'invitation-accepted',
            kind: 'email',
            target: 'accepted@example.com',
            role: 'member',
            expiresAt: '2026-08-10T00:00:00.000Z',
            acceptedAt: '2026-08-08T01:00:00.000Z',
            revokedAt: null,
            createdAt: '2026-08-08T00:00:00.000Z',
          },
          {
            id: 'invitation-revoked',
            kind: 'email',
            target: 'revoked@example.com',
            role: 'member',
            expiresAt: '2026-08-10T00:00:00.000Z',
            acceptedAt: null,
            revokedAt: '2026-08-08T01:00:00.000Z',
            createdAt: '2026-08-08T00:00:00.000Z',
          },
        ]}
        onInvite={onInvite}
        onRevokeInvitation={vi.fn()}
        onChangeRole={onChangeRole}
        onRemove={onRemove}
      />,
    );

    fireEvent.change(screen.getByLabelText('邀请账号'), { target: { value: 'admin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '发送邀请' }));
    await waitFor(() =>
      expect(onInvite).toHaveBeenCalledWith(expect.objectContaining({ target: 'admin@example.com' })),
    );
    fireEvent.change(screen.getByLabelText('Rocky 的组织角色'), { target: { value: 'admin' } });
    await waitFor(() => expect(onChangeRole).toHaveBeenCalledWith('member-a', 'admin'));
    fireEvent.click(screen.getByRole('button', { name: '移除 Rocky' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('member-a'));
    expect(screen.getByText('已接受')).toBeInTheDocument();
    expect(screen.getByText('已撤销')).toBeInTheDocument();
    expect(screen.getByText('等待接受')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '撤销' })).toHaveLength(1);
  });
});
