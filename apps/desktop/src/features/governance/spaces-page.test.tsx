import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpacesGovernancePage } from './spaces-page';

describe('SpacesGovernancePage', () => {
  it('blocks invalid Chinese space identifiers before sending the request', () => {
    const onCreate = vi.fn(async () => undefined);
    render(
      <SpacesGovernancePage
        online
        spaces={[]}
        organizationMembers={[]}
        loadMembers={async () => []}
        onCreate={onCreate}
        onPolicy={vi.fn()}
        onArchive={vi.fn()}
        onAddMember={vi.fn()}
        onChangeMemberRole={vi.fn()}
        onRemoveMember={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('空间名称'), { target: { value: '团队1' } });
    fireEvent.change(screen.getByLabelText('英文标识'), { target: { value: '团队1' } });

    expect(screen.getByText('仅支持小写英文字母、数字和连字符，且必须以字母或数字开头。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建空间' })).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('creates spaces and manages policy and membership', async () => {
    const onCreate = vi.fn(async () => undefined);
    const onPolicy = vi.fn(async () => undefined);
    const onAddMember = vi.fn(async () => undefined);
    render(
      <SpacesGovernancePage
        online
        spaces={[
          {
            id: 'space-a',
            organizationId: 'org-a',
            type: 'team',
            name: 'Platform',
            slug: 'platform',
            reviewPolicy: 'required',
            status: 'active',
          },
        ]}
        organizationMembers={[
          {
            id: 'member-a',
            userId: 'user-a',
            displayName: 'Rocky',
            role: 'member',
            status: 'active',
            joinedAt: '2026-08-08T00:00:00.000Z',
          },
        ]}
        loadMembers={async () => []}
        onCreate={onCreate}
        onPolicy={onPolicy}
        onArchive={vi.fn()}
        onAddMember={onAddMember}
        onChangeMemberRole={vi.fn()}
        onRemoveMember={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('空间名称'), { target: { value: 'Delivery' } });
    fireEvent.change(screen.getByLabelText('英文标识'), { target: { value: 'delivery' } });
    fireEvent.change(screen.getByLabelText('创建空间审核策略'), { target: { value: 'direct' } });
    fireEvent.click(screen.getByRole('button', { name: '创建空间' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Delivery', slug: 'delivery', reviewPolicy: 'direct' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Platform/ }));
    fireEvent.change(screen.getByLabelText('已选空间审核策略'), { target: { value: 'direct' } });
    await waitFor(() => expect(onPolicy).toHaveBeenCalledWith('space-a', 'direct'));
    fireEvent.click(screen.getByRole('button', { name: '添加空间成员' }));
    await waitFor(() => expect(onAddMember).toHaveBeenCalledWith('space-a', 'user-a', 'viewer'));
  });
});
