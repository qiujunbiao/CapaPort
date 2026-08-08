import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpacesGovernancePage } from './spaces-page';

describe('SpacesGovernancePage', () => {
  it('creates a named space without exposing a technical identifier', async () => {
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

    expect(screen.queryByLabelText('英文标识')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('空间名称'), { target: { value: '团队一' } });
    fireEvent.click(screen.getByRole('button', { name: '创建空间' }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        type: 'team',
        name: '团队一',
        reviewPolicy: 'required',
      }),
    );
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
    fireEvent.change(screen.getByLabelText('创建空间审核策略'), { target: { value: 'direct' } });
    fireEvent.click(screen.getByRole('button', { name: '创建空间' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Delivery', reviewPolicy: 'direct' })),
    );
    fireEvent.click(screen.getByRole('button', { name: /Platform/ }));
    fireEvent.change(screen.getByLabelText('已选空间审核策略'), { target: { value: 'direct' } });
    await waitFor(() => expect(onPolicy).toHaveBeenCalledWith('space-a', 'direct'));
    fireEvent.click(screen.getByRole('button', { name: '添加空间成员' }));
    await waitFor(() => expect(onAddMember).toHaveBeenCalledWith('space-a', 'user-a', 'viewer'));
  });

  it('creates a project with a trimmed name and direct publishing', async () => {
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

    fireEvent.change(screen.getByLabelText('空间类型'), { target: { value: 'project' } });
    fireEvent.change(screen.getByLabelText('空间名称'), { target: { value: '  rocky1  ' } });
    fireEvent.change(screen.getByLabelText('创建空间审核策略'), { target: { value: 'direct' } });
    fireEvent.click(screen.getByRole('button', { name: '创建空间' }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({ type: 'project', name: 'rocky1', reviewPolicy: 'direct' }),
    );
  });

  it('shows a create error and permits retrying after the request finishes', async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error('创建空间失败')).mockResolvedValueOnce(undefined);
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

    fireEvent.change(screen.getByLabelText('空间名称'), { target: { value: '团队一' } });
    fireEvent.click(screen.getByRole('button', { name: '创建空间' }));
    expect(await screen.findByText('创建空间失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建空间' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
  });

  it('prevents duplicate create requests before the busy state is rendered', async () => {
    let finishCreate: (() => void) | undefined;
    const onCreate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCreate = resolve;
        }),
    );
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

    fireEvent.change(screen.getByLabelText('空间名称'), { target: { value: '项目一' } });
    const createButton = screen.getByRole('button', { name: '创建空间' });
    await act(async () => {
      createButton.click();
      createButton.click();
    });

    expect(onCreate).toHaveBeenCalledTimes(1);
    finishCreate?.();
    await waitFor(() => expect(createButton).not.toBeDisabled());
  });
});
