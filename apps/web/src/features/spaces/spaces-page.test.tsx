import type { SpaceSummary } from '@capaport/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { webFixture } from '../../test/fixtures';
import { SpacesPage } from './spaces-page';

describe('SpacesPage', () => {
  it('creates a project without asking for a technical identifier', async () => {
    const client = webFixture();
    client.createSpace = vi.fn(async (input) => ({
      id: 'space-new',
      organizationId: 'org-a',
      slug: 'space-generated',
      status: 'active',
      ...input,
    }));
    render(<SpacesPage client={client} spaces={[]} organizationMembers={[]} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    expect(screen.queryByLabelText('英文标识')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('空间名称'), { target: { value: '  rocky1  ' } });
    fireEvent.change(screen.getByLabelText('空间类型'), { target: { value: 'project' } });
    fireEvent.change(screen.getByLabelText('发布策略'), { target: { value: 'direct' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() =>
      expect(client.createSpace).toHaveBeenCalledWith({
        type: 'project',
        name: 'rocky1',
        reviewPolicy: 'direct',
      }),
    );
  });

  it('prevents duplicate create requests before the pending state is rendered', async () => {
    let finishCreate: (() => void) | undefined;
    const client = webFixture();
    client.createSpace = vi.fn(
      () =>
        new Promise<SpaceSummary>((resolve) => {
          finishCreate = () =>
            resolve({
              id: 'space-new',
              organizationId: 'org-a',
              type: 'team',
              name: '团队一',
              slug: 'space-generated',
              reviewPolicy: 'required',
              status: 'active',
            });
        }),
    );
    render(<SpacesPage client={client} spaces={[]} organizationMembers={[]} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByLabelText('空间名称'), { target: { value: '团队一' } });
    const createButton = screen.getByRole('button', { name: '创建' });
    await act(async () => {
      createButton.click();
      createButton.click();
    });

    expect(client.createSpace).toHaveBeenCalledTimes(1);
    finishCreate?.();
    await waitFor(() => expect(screen.queryByRole('button', { name: '创建' })).not.toBeInTheDocument());
  });
});
