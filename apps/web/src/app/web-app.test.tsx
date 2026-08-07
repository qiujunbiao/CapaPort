import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { webFixture } from '../test/fixtures';
import { createMemoryWebSessionStore } from './session-store';
import { WebApp } from './web-app';

describe('organization web console', () => {
  it('protects administrator routes behind authentication', () => {
    render(<WebApp client={webFixture()} sessionStore={createMemoryWebSessionStore()} />);
    expect(screen.getByRole('heading', { name: '登录管理后台' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '成员与邀请' })).not.toBeInTheDocument();
  });

  it('shows permission-aware navigation for an organization member', async () => {
    render(
      <WebApp
        client={webFixture({ role: 'member' })}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    expect(await screen.findByRole('button', { name: '能力市场' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '成员与邀请' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '审核中心' })).not.toBeInTheDocument();
  });

  it('lets an owner invite a member with a role', async () => {
    const client = webFixture({ role: 'owner' });
    render(
      <WebApp
        client={client}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '成员与邀请' }));
    fireEvent.change(screen.getByLabelText('邀请邮箱或手机号'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('组织角色'), { target: { value: 'auditor' } });
    fireEvent.click(screen.getByRole('button', { name: '发送邀请' }));
    expect(await screen.findByRole('status')).toHaveTextContent('邀请已发送');
  });

  it('filters review items and exposes an accessible empty state', async () => {
    render(
      <WebApp
        client={webFixture({ role: 'admin', publications: [] })}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '审核中心' }));
    expect(await screen.findByRole('heading', { name: '暂无待审核发布' })).toBeInTheDocument();
  });

  it('keeps audit metadata redacted in the rendered table', async () => {
    render(
      <WebApp
        client={webFixture({ role: 'auditor' })}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '审计日志' }));
    expect(await screen.findByText('publication.approved')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret-token');
    expect(document.body.textContent).not.toContain('/Users/private');
  });
});
