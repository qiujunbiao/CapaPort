import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandLockup, BrandMark } from './brand';

describe('web brand', () => {
  it('renders an accessible lockup with optional context', () => {
    render(<BrandLockup tone="dark" context="CONTROL PLANE" />);
    expect(screen.getByRole('img', { name: 'CapaPort' })).toBeInTheDocument();
    expect(screen.getByText('CAPAPORT')).toBeInTheDocument();
    expect(screen.getByText('CONTROL PLANE')).toBeInTheDocument();
  });

  it('keeps a decorative mark out of the accessibility tree', () => {
    const { container } = render(<BrandMark decorative />);
    expect(container.querySelector('img')).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes a standalone mark when it carries brand meaning', () => {
    render(<BrandMark />);
    expect(screen.getByRole('img', { name: 'CapaPort' })).toHaveClass('brand-mark--dark');
  });
});
