/**
 * Shared recharts tooltip content, styled with theme tokens (recharts'
 * default tooltip hardcodes white). One component so every chart's hover
 * layer looks identical.
 */
import './Shared.css';

/** The slice of recharts' tooltip payload we actually render. */
interface TooltipEntry {
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  unit?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  /** Optional formatter for the numeric value (e.g. add "%" or "ms"). */
  formatValue?: (value: number | string) => string;
  /** Optional formatter for the x label (e.g. short date). */
  formatLabel?: (label: string | number) => string;
}

/**
 * Every prop is optional because recharts owns the call: this is handed to a
 * `<Tooltip content={…} />` and invoked with whatever the chart has, including
 * while inactive. Hence the null return rather than an empty shell — recharts
 * keeps the element mounted between hovers.
 */
export default function ChartTooltip({ active, label, payload, formatValue, formatLabel }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="chart-tooltip">
      {label !== undefined && (
        <div className="tooltip-title">{formatLabel ? formatLabel(label) : label}</div>
      )}
      {payload.map((entry, i) => {
        const raw = Array.isArray(entry.value) ? entry.value.join('–') : entry.value;
        return (
          <div className="tooltip-row" key={i}>
            <span className="dot" style={{ background: entry.color ?? 'var(--text-muted)' }} />
            <span>{entry.name}:</span>
            <strong style={{ color: 'var(--text-primary)' }}>
              {raw !== undefined && formatValue ? formatValue(raw) : raw}
              {entry.unit ?? ''}
            </strong>
          </div>
        );
      })}
    </div>
  );
}
