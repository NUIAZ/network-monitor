/**
 * Severity chip for alerts and vulnerabilities. Always icon + label — never
 * color alone — so severity survives grayscale printing and color-vision
 * deficiency.
 */
import { humanize } from '../../utils/format';
import './Shared.css';

interface SeverityStyle {
  tone: 'critical' | 'warning' | 'info' | 'success' | 'neutral';
  icon: string;
}

const SEVERITIES: Record<string, SeverityStyle> = {
  critical: { tone: 'critical', icon: 'bi-exclamation-octagon-fill' },
  high: { tone: 'critical', icon: 'bi-exclamation-triangle-fill' },
  warning: { tone: 'warning', icon: 'bi-exclamation-triangle-fill' },
  medium: { tone: 'warning', icon: 'bi-dash-circle-fill' },
  info: { tone: 'info', icon: 'bi-info-circle-fill' },
  low: { tone: 'info', icon: 'bi-info-circle' },
};

export default function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  const key = (severity ?? '').toLowerCase();
  const style = SEVERITIES[key] ?? { tone: 'neutral' as const, icon: 'bi-question-circle' };
  return (
    <span
      className={`severity-badge${style.tone !== 'neutral' ? ` sev-${style.tone}` : ''}`}
      data-testid="severity-badge"
      data-severity={key}
    >
      <i className={`bi ${style.icon}`} />
      {humanize(severity)}
    </span>
  );
}
