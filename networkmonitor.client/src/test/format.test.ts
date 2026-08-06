/**
 * Formatting helpers — pure functions, exact expectations.
 */
import { describe, expect, it } from 'vitest';
import {
  formatBps,
  formatDuration,
  formatPercent,
  humanize,
  isValidCidr,
  relativeTime,
} from '../utils/format';

describe('relativeTime', () => {
  const now = new Date('2026-08-05T12:00:00Z');

  it('handles the standard buckets', () => {
    expect(relativeTime('2026-08-05T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-08-05T11:55:00Z', now)).toBe('5m ago');
    expect(relativeTime('2026-08-05T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-08-03T12:00:00Z', now)).toBe('2d ago');
  });

  it('falls back to a date past one week', () => {
    expect(relativeTime('2026-07-01T12:00:00Z', now)).toMatch(/Jul/);
  });

  it('returns a dash for null/garbage', () => {
    expect(relativeTime(null)).toBe('—');
    expect(relativeTime('not-a-date')).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(200)).toBe('3m 20s');
    expect(formatDuration(300)).toBe('5m');
    expect(formatDuration(4320)).toBe('1h 12m');
    expect(formatDuration(3600)).toBe('1h');
  });

  it('returns a dash for null and negatives', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });
});

describe('formatBps', () => {
  it('picks the right magnitude', () => {
    expect(formatBps(1_000_000_000)).toBe('1 Gbps');
    expect(formatBps(100_000_000)).toBe('100 Mbps');
    expect(formatBps(2_500_000_000)).toBe('2.5 Gbps');
    expect(formatBps(0)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('trims trailing zeros but keeps meaningful decimals', () => {
    expect(formatPercent(42)).toBe('42%');
    expect(formatPercent(3.54)).toBe('3.5%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('humanize', () => {
  it('capitalizes and de-underscores', () => {
    expect(humanize('accepted_risk')).toBe('Accepted risk');
    expect(humanize('device_offline')).toBe('Device offline');
    expect(humanize(null)).toBe('—');
  });
});

describe('isValidCidr', () => {
  it('accepts real CIDRs', () => {
    expect(isValidCidr('192.168.10.0/24')).toBe(true);
    expect(isValidCidr('10.0.0.0/8')).toBe(true);
    expect(isValidCidr('203.0.113.0/32')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isValidCidr('192.168.10.0')).toBe(false); // no prefix
    expect(isValidCidr('256.1.1.0/24')).toBe(false); // octet out of range
    expect(isValidCidr('192.168.10.0/33')).toBe(false); // prefix out of range
    expect(isValidCidr('not a cidr')).toBe(false);
    expect(isValidCidr('')).toBe(false);
  });
});
