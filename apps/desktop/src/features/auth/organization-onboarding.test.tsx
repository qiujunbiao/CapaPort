import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cloudFixture } from '../../test/fixtures';
import { OrganizationOnboarding } from './organization-onboarding';

describe('desktop organization onboarding', () => {
  it('creates an organization from an editable name without asking for a technical identifier', async () => {
    const cloud = cloudFixture();
    const createOrganization = vi.fn(async () => ({
      id: 'org-new',
      name: '海岸小香蕉',
      slug: 'org-generated',
      role: 'owner' as const,
      status: 'active' as const,
    }));
    cloud.createOrganization = createOrganization;

    render(
      <OrganizationOnboarding
        cloud={cloud}
        session={{ accessToken: 'token', refreshToken: 'refresh' }}
        onReady={vi.fn()}
      />,
    );

    const name = screen.getByLabelText('组织名称');
    fireEvent.change(name, { target: { value: '海岸' } });
    fireEvent.change(name, { target: { value: '海岸小香蕉' } });
    expect(name).toHaveValue('海岸小香蕉');
    expect(screen.queryByLabelText('组织标识')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '创建并进入' }));
    await waitFor(() =>
      expect(createOrganization).toHaveBeenCalledWith(
        { accessToken: 'token', refreshToken: 'refresh' },
        { name: '海岸小香蕉' },
      ),
    );
  });
});
