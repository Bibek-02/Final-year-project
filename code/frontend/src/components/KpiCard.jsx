import React from 'react';
import { ArrowUp, ArrowDown, Info } from 'lucide-react';

const TONE_TEXT = {
  primary: 'text-indigo-600 dark:text-indigo-400',
  success: 'text-semantic-success dark:text-green-400',
  warning: 'text-semantic-warning dark:text-amber-400',
  danger : 'text-semantic-danger dark:text-red-400',
  neutral: 'text-gray-800 dark:text-gray-100',
};

const TONE_BADGE = {
  primary: 'bg-indigo-600',
  success: 'bg-semantic-success',
  warning: 'bg-semantic-warning',
  danger : 'bg-semantic-danger',
  neutral: 'bg-gray-500',
};

// `trend` is optional: { value: number, direction: 'up' | 'down' }. When
// present it replaces `sublabel` rather than stacking both — "vs previous
// period" already carries the context a static sublabel would.
// `tooltip` is optional plain-language text for a technical label (e.g.
// "Test MAPE") — a native `title` keeps it keyboard-focusable (tab + hover)
// without a custom tooltip component.
// `compact` renders the value at a smaller size — for KPIs whose value is a
// short string (e.g. a date) rather than a number, the default 30px
// `.kpi-value` size reads as oversized.
export default function KpiCard({ label, value, sublabel, tone = 'primary', icon: Icon, trend, tooltip, compact = false }) {
  const TrendIcon = trend?.direction === 'up' ? ArrowUp : ArrowDown;
  return (
    <div className="metric-card">
      <div className="flex items-start justify-between mb-1.5">
        <p className="field-label flex items-center gap-1">
          {label}
          {tooltip && (
            <span
              tabIndex={0}
              role="img"
              aria-label={tooltip}
              title={tooltip}
              className="inline-flex text-gray-500 dark:text-gray-400 cursor-help
                         focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded-full"
            >
              <Info size={12} />
            </span>
          )}
        </p>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center
                          flex-shrink-0 ${TONE_BADGE[tone] || TONE_BADGE.primary}`}>
            <Icon size={15} className="text-white" />
          </div>
        )}
      </div>
      <p className={`${compact ? 'text-lg font-bold leading-snug' : 'kpi-value'} ${TONE_TEXT[tone] || TONE_TEXT.primary}`}>
        {value}
      </p>
      {trend ? (
        <p className="flex items-center gap-1 mt-0.5">
          <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
            trend.direction === 'up'
              ? 'text-semantic-success dark:text-green-400'
              : 'text-semantic-danger dark:text-red-400'
          }`}>
            <TrendIcon size={12} />
            {Math.abs(trend.value).toFixed(1)}%
          </span>
          <span className="text-secondary text-xs">vs previous period</span>
        </p>
      ) : sublabel ? (
        <p className="text-secondary text-xs mt-0.5">{sublabel}</p>
      ) : null}
    </div>
  );
}
