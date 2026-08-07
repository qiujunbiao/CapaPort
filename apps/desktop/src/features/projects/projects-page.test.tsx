import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectsPage } from './projects-page';

const space = {
  id: 'project-a',
  organizationId: 'org-a',
  type: 'project' as const,
  name: '支付平台',
  slug: 'payments',
  reviewPolicy: 'required' as const,
  status: 'active' as const,
};
const activeBinding = {
  localBindingId: '11111111-1111-4111-8111-111111111111',
  spaceId: space.id,
  localPath: '/private/projects/payments-api',
  agents: ['codex' as const, 'claude-code' as const],
  status: 'active' as const,
  createdAt: '0001',
};
const bindings = [
  activeBinding,
  {
    localBindingId: '22222222-2222-4222-8222-222222222222',
    spaceId: space.id,
    localPath: '/private/projects/payments-docs',
    agents: ['cursor' as const],
    status: 'missing' as const,
    createdAt: '0002',
  },
];

describe('ProjectsPage', () => {
  it('supports multiple local directories and synchronizes only explicit eligible files', async () => {
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectsPage
        spaces={[space]}
        loadBindings={vi.fn().mockResolvedValue(bindings)}
        onBind={vi.fn()}
        onRemove={vi.fn()}
        onInventory={vi.fn().mockResolvedValue({
          localBindingId: activeBinding.localBindingId,
          status: 'active',
          entries: [
            { relativePath: 'README.md', sizeBytes: 20, eligible: true },
            { relativePath: 'docs/policy.yaml', sizeBytes: 40, eligible: true },
            { relativePath: 'src/index.ts', sizeBytes: 80, eligible: false, ignoreReason: 'source-code' },
          ],
          eligibleFiles: 2,
          eligibleBytes: 60,
          ignored: [{ reason: 'source-code', count: 1 }],
        })}
        onSync={onSync}
      />,
    );
    expect(await screen.findByText('payments-api')).toBeInTheDocument();
    expect(screen.getByText('payments-docs')).toBeInTheDocument();
    expect(screen.getByText('目录已移除')).toBeInTheDocument();
    const [selectButton] = screen.getAllByRole('button', { name: '选择同步' });
    expect(selectButton).toBeDefined();
    if (!selectButton) throw new Error('Active binding action is missing.');
    fireEvent.click(selectButton);
    expect(await screen.findByText('src/index.ts')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /src\/index\.ts/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /docs\/policy\.yaml/ }));
    fireEvent.click(screen.getByRole('button', { name: '同步 1 个文件' }));
    await waitFor(() =>
      expect(onSync).toHaveBeenCalledWith(space.id, activeBinding, ['README.md'], ['codex', 'claude-code']),
    );
  });
});
