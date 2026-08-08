import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandLockup, BrandMark } from './brand';

describe('desktop brand', () => {
  it('renders the accessible product lockup and context', () => {
    render(<BrandLockup tone="dark" context="CAPABILITY REGISTRY" />);
    expect(screen.getByRole('img', { name: 'CapaPort' })).toBeInTheDocument();
    expect(screen.getByText('CAPAPORT')).toBeInTheDocument();
    expect(screen.getByText('CAPABILITY REGISTRY')).toBeInTheDocument();
  });

  it('uses a mark-only lockup in compact navigation', () => {
    const { container } = render(<BrandLockup compact />);
    expect(screen.getByRole('img', { name: 'CapaPort' })).toBeInTheDocument();
    expect(screen.queryByText('CAPAPORT')).not.toBeInTheDocument();
    expect(container.querySelector('.brand-mark')).toBeInTheDocument();
  });

  it('supports decorative and meaningful standalone marks', () => {
    const { container, rerender } = render(<BrandMark decorative />);
    expect(container.querySelector('img')).toHaveAttribute('aria-hidden', 'true');
    rerender(<BrandMark />);
    expect(screen.getByRole('img', { name: 'CapaPort' })).toHaveClass('brand-mark--dark');
  });
});
