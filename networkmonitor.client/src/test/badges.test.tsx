/**
 * StatusPill / SeverityBadge: word → tone mapping and icon presence.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusPill from '../Components/Shared/StatusPill';
import SeverityBadge from '../Components/Shared/SeverityBadge';

describe('StatusPill', () => {
  it('maps online to the success tone', () => {
    render(<StatusPill status="online" />);
    const pill = screen.getByTestId('status-pill');
    expect(pill).toHaveClass('pill-success');
    expect(pill).toHaveTextContent('Online');
  });

  it('maps offline/failed to the error tone', () => {
    render(<StatusPill status="failed" />);
    expect(screen.getByTestId('status-pill')).toHaveClass('pill-error');
  });

  it('maps new to the info tone', () => {
    render(<StatusPill status="new" />);
    expect(screen.getByTestId('status-pill')).toHaveClass('pill-info');
  });

  it('renders unmapped words neutrally instead of crashing', () => {
    render(<StatusPill status="mystery_state" />);
    const pill = screen.getByTestId('status-pill');
    expect(pill.className).toBe('status-pill');
    expect(pill).toHaveTextContent('Mystery state');
  });
});

describe('SeverityBadge', () => {
  it('renders critical with the critical tone and a filled icon', () => {
    render(<SeverityBadge severity="critical" />);
    const badge = screen.getByTestId('severity-badge');
    expect(badge).toHaveClass('sev-critical');
    expect(badge.querySelector('i.bi-exclamation-octagon-fill')).not.toBeNull();
  });

  it('renders warning with the warning tone', () => {
    render(<SeverityBadge severity="warning" />);
    expect(screen.getByTestId('severity-badge')).toHaveClass('sev-warning');
  });

  it('renders info with the info tone', () => {
    render(<SeverityBadge severity="info" />);
    expect(screen.getByTestId('severity-badge')).toHaveClass('sev-info');
  });

  it('always pairs color with an icon (never color alone)', () => {
    for (const severity of ['critical', 'high', 'warning', 'medium', 'info', 'low']) {
      const { unmount } = render(<SeverityBadge severity={severity} />);
      expect(screen.getByTestId('severity-badge').querySelector('i.bi')).not.toBeNull();
      unmount();
    }
  });
});
