import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, BarChart3, ArrowUp, ArrowDown, Activity, Percent, Download, Info,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
} from 'lucide-react';
import client from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { useChartColors } from '../../hooks/useChartColors';
import { useIsMobile } from '../../hooks/useIsMobile';
import PageHeader from '../../components/PageHeader';
import AlertBanner from '../../components/AlertBanner';
import EmptyState from '../../components/EmptyState';
import KpiCard from '../../components/KpiCard';
import { SkeletonCard, SkeletonChart, SkeletonTable } from '../../components/Skeleton';

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

// Full-length formatters (table cells, tooltips, the date-range context line).
const FULL_DATE_FMT        = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const MONTH_YEAR_FMT       = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const DAY_MONTH_FMT        = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });
const MONTH_ONLY_FMT       = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const SHORT_DATE_FMT       = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
// Abbreviated formatters (chart X-axis ticks only — compact spacing).
const DAY_MONTH_SHORT_FMT  = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const SHORT_MONTH_YEAR_FMT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

// Real minus sign (U+2212), not the ASCII hyphen-minus that Number.toFixed
// produces — used everywhere a negative value is shown (table, tooltip, CSV).
const MINUS = '−';

// Factual, threshold-free labels for how a prediction relates to its actual
// value — replaces the old tolerance-based "Close forecast" category, which
// presented an arbitrary percentage window as a validated measure of
// forecast quality. Determined from ORIGINAL (unrounded) values everywhere
// it's computed, never from rounded display figures.
const DIRECTION_BADGE = {
  'Above actual' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400',
  'Below actual' : 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400',
  'Matches actual': 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

function toDate(period) {
  return new Date(`${period}T00:00:00`);
}

// ---- Pure formatting/derivation helpers — exported so tests can verify
// exact output without fighting Recharts' SVG rendering in JSDOM. ----

export function pickEvenIndices(length, count) {
  if (length <= count) return new Set(Array.from({ length }, (_, i) => i));
  const picks = new Set();
  for (let i = 0; i < count; i++) {
    picks.add(Math.round((i * (length - 1)) / (count - 1)));
  }
  return picks;
}

export function formatFullDate(period) {
  return FULL_DATE_FMT.format(toDate(period));
}

export function formatShortPeriod(period, forecastType) {
  return forecastType === 'weekly'
    ? SHORT_DATE_FMT.format(toDate(period))
    : SHORT_MONTH_YEAR_FMT.format(toDate(period));
}

export function formatWeeklyPeriod(period) {
  return `Week beginning ${formatFullDate(period)}`;
}

export function formatMonthlyPeriod(period) {
  return MONTH_YEAR_FMT.format(toDate(period));
}

export function formatPeriodLabel(period, forecastType) {
  return forecastType === 'weekly' ? formatWeeklyPeriod(period) : formatMonthlyPeriod(period);
}

// Compact per-cell period text for the breakdown table — paired with a
// dynamic column heading ("Week beginning" / "Month") that carries the
// context the long formatPeriodLabel() form would otherwise repeat on every
// row, which was wide enough to wrap and produce uneven row heights.
export function formatTablePeriod(period, forecastType) {
  return forecastType === 'weekly' ? formatShortPeriod(period, 'weekly') : formatMonthlyPeriod(period);
}

export function formatDateRange(periods, forecastType) {
  if (!periods || periods.length === 0) return '';
  const sorted = [...periods].sort();
  const first = toDate(sorted[0]);
  const last = toDate(sorted[sorted.length - 1]);
  const sameYear = first.getFullYear() === last.getFullYear();
  if (forecastType === 'monthly') {
    const firstLabel = sameYear ? MONTH_ONLY_FMT.format(first) : MONTH_YEAR_FMT.format(first);
    return `${firstLabel}–${MONTH_YEAR_FMT.format(last)}`;
  }
  const firstLabel = sameYear ? DAY_MONTH_FMT.format(first) : FULL_DATE_FMT.format(first);
  return `${firstLabel}–${FULL_DATE_FMT.format(last)}`;
}

// Zero-based "nice" domain: +10% headroom, ceiling rounded to a
// 1/2/4/5/6/8/10 x 10^n step. Used for the "Start at zero" mode, and as the
// fallback for focusedDomain's degenerate cases (flat/all-zero/empty series).
const NICE_STEPS = [1, 2, 4, 5, 6, 8, 10];
export function niceDomain(values) {
  const finite = (values || []).filter(v => Number.isFinite(v));
  const max = finite.length ? Math.max(...finite, 0) : 0;
  if (max <= 0) return [0, 1];
  const withHeadroom = max * 1.1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(withHeadroom)));
  const normalized = withHeadroom / magnitude;
  const niceNormalized = NICE_STEPS.find(step => normalized <= step) ?? 10;
  return [0, niceNormalized * magnitude];
}

function niceStep(rawStep) {
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

// Default (focused) domain: pads the observed [min, max] range by ~10% and
// rounds both ends outward to a shared "nice" step, so the axis hugs the
// data instead of always starting at zero. Falls back to the zero-based
// niceDomain() for a constant/all-zero/degenerate series, where there is no
// range to focus on.
export function focusedDomain(values, tickCount = 6) {
  const finite = (values || []).filter(v => Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  const rawMin = Math.min(...finite);
  const rawMax = Math.max(...finite);
  if (rawMin === rawMax) return niceDomain(finite);

  const range = rawMax - rawMin;
  const pad = range * 0.1;
  const paddedMin = Math.max(0, rawMin - pad); // sales values are never negative
  const paddedMax = rawMax + pad;

  const step = niceStep((paddedMax - paddedMin) / (tickCount - 1));
  const niceFloor = Math.max(0, Math.floor(paddedMin / step) * step);
  const niceCeil = Math.ceil(paddedMax / step) * step;

  if (niceCeil <= niceFloor) return niceDomain(finite); // defensive: never a zero-width/inverted domain
  return [niceFloor, niceCeil];
}

// Always pools Predicted AND Actual values regardless of whether the actual
// -sales toggle is currently on, so the Y-axis never shifts when that toggle
// is switched — only when the underlying chart data itself changes.
function seriesValues(data) {
  const values = [];
  (data || []).forEach(d => {
    if (Number.isFinite(d.Predicted)) values.push(d.Predicted);
    if (d.Actual != null && Number.isFinite(d.Actual)) values.push(d.Actual);
  });
  return values;
}

// Distinguishes "no previous period exists" (first period in the window)
// from "a previous period exists but its prediction was zero" (percentage
// change is undefined) — both would otherwise collapse into the same
// "0%"/blank text, which misrepresents an undefined change as no change.
export function describePeriodChange(current, previous) {
  if (!previous) {
    return { state: 'no-previous', text: 'No previous prediction' };
  }
  if (!previous.prediction) {
    return { state: 'zero-previous', text: 'Not calculable' };
  }
  const pct = ((current.prediction - previous.prediction) / Math.abs(previous.prediction)) * 100;
  return {
    state: 'ok',
    value: pct,
    direction: current.prediction >= previous.prediction ? 'up' : 'down',
    text: `${pct >= 0 ? '+' : MINUS}${Math.abs(pct).toFixed(1)}%`,
  };
}

// Factual direction only — no tolerance/threshold. "Matches actual" fires
// only on an exact match of the original (unrounded) values; everything
// else is either above or below. Never called with pre-rounded numbers.
export function classifyResult(predicted, actual) {
  const diff = predicted - actual;
  if (diff === 0) return 'Matches actual';
  return diff > 0 ? 'Above actual' : 'Below actual';
}

export function computeMAE(forecasts) {
  const eligible = forecasts.filter(f => f.actual_sales != null);
  if (!eligible.length) return null;
  const total = eligible.reduce((sum, f) => sum + Math.abs(f.actual_sales - f.prediction), 0);
  return total / eligible.length;
}

// Rows with zero actual sales are excluded (percentage error is undefined
// when the denominator is zero) — disclosed via the KPI's tooltip/sublabel,
// not silently dropped.
export function computeMAPE(forecasts) {
  const eligible = forecasts.filter(f => f.actual_sales != null && f.actual_sales !== 0);
  if (!eligible.length) return null;
  const total = eligible.reduce((sum, f) => sum + Math.abs(f.actual_sales - f.prediction) / Math.abs(f.actual_sales), 0);
  return (total / eligible.length) * 100;
}

// Explains a null MAE/MAPE honestly instead of a bare "N/A" — distinguishes
// "no recorded sales at all" from "recorded sales exist but are all zero".
export function unavailableReason(forecasts, { requireNonZero = false } = {}) {
  const withActual = forecasts.filter(f => f.actual_sales != null);
  if (withActual.length === 0) return 'No recorded sales are available for the displayed periods.';
  if (requireNonZero && withActual.every(f => f.actual_sales === 0)) {
    return 'All periods with recorded sales have zero actual sales.';
  }
  return 'No eligible periods for this calculation.';
}

function csvEscape(value) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Every figure here is derived from the ORIGINAL forecast values (never a
// pre-rounded display string), matching the table/tooltip/summary
// calculations exactly — only the final cell text is rounded for display.
export function buildCsv(forecasts, forecastType, showActual) {
  const headers = showActual
    ? ['Period', 'Predicted Sales', 'Actual Sales', 'Predicted Minus Actual', 'Absolute Percentage Error', 'Direction']
    : ['Period', 'Predicted Sales', 'Change From Previous Prediction'];
  const lines = [headers.join(',')];

  forecasts.forEach((f, i) => {
    const label = csvEscape(formatPeriodLabel(f.period, forecastType));
    const predicted = Math.round(f.prediction);

    if (!showActual) {
      const previous = i > 0 ? forecasts[i - 1] : null;
      const change = describePeriodChange(f, previous);
      lines.push([label, predicted, csvEscape(change.text)].join(','));
      return;
    }

    const hasActual = f.actual_sales != null;
    const actual = hasActual ? Math.round(f.actual_sales) : '';
    const diffRaw = hasActual ? f.prediction - f.actual_sales : null;
    const diffLabel = hasActual ? `${diffRaw >= 0 ? '+' : MINUS}${Math.abs(Math.round(diffRaw))}` : '';
    const ape = hasActual
      ? (f.actual_sales !== 0 ? `${((Math.abs(diffRaw) / Math.abs(f.actual_sales)) * 100).toFixed(1)}%` : 'Undefined')
      : '';
    const direction = hasActual ? classifyResult(f.prediction, f.actual_sales) : 'Unavailable';
    lines.push([label, predicted, actual, diffLabel, ape, csvEscape(direction)].join(','));
  });

  return lines.join('\n');
}

function downloadCsv(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---- Presentational subcomponents ----

// Small keyboard-focusable hint icon — mirrors KpiCard's own `tooltip` prop
// pattern (tabIndex + native title + aria-label) rather than a plain `title`
// attribute on a table header, so column help works on focus/touch too, not
// only mouse hover.
function HeaderHint({ text }) {
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={text}
      title={text}
      className="inline-flex ml-1 align-middle text-gray-400 dark:text-gray-500 cursor-help
                 focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded-full"
    >
      <Info size={12} />
    </span>
  );
}

// Collapsed by default, driven by explicit React state (rather than native
// <details> default-open behaviour) so the chevron icon is guaranteed to
// agree with the open/closed state — same controlled-disclosure convention
// Explanation.jsx uses for its own "Show technical details" section.
function AboutSection({ forecastType, closeThresholdNote }) {
  const [open, setOpen] = useState(false);
  const steps = [
    { title: 'View the forecast', desc: `Examine ${forecastType} predicted sales for the selected store.` },
    { title: 'Compare with actuals', desc: 'Reveal recorded sales to evaluate the saved predictions retrospectively.' },
    { title: 'Inspect each period', desc: 'Select a chart point, use Previous/Next, or select a table row to review its values.' },
  ];

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-700/60 bg-gray-50/60
                    dark:bg-gray-800/40 px-5 py-3 mb-6">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 min-h-[44px] text-sm font-semibold
                   text-gray-700 dark:text-gray-200 focus:outline-none focus-visible:ring-2
                   focus-visible:ring-indigo-400 rounded"
      >
        <span className="flex items-center gap-2">
          <Info size={14} className="text-indigo-500 dark:text-indigo-400 flex-shrink-0" aria-hidden="true" />
          About this analysis
        </span>
        {open
          ? <ChevronUp size={16} className="text-gray-400 dark:text-gray-500 flex-shrink-0" aria-hidden="true" />
          : <ChevronDown size={16} className="text-gray-400 dark:text-gray-500 flex-shrink-0" aria-hidden="true" />}
      </button>

      {open && (
        <div className="mt-3 text-xs space-y-3 animate-fadeIn">
          <p className="text-secondary max-w-3xl">
            This page presents precomputed XGBoost sales predictions for the selected store, held out during
            model testing. Recorded sales are shown here for historical comparison against those saved predictions.
          </p>

          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {steps.map(step => (
              <div key={step.title}>
                <dt className="font-semibold text-gray-700 dark:text-gray-200">{step.title}</dt>
                <dd className="text-secondary mt-0.5">{step.desc}</dd>
              </div>
            ))}
          </dl>

          <div className="pt-2 border-t border-gray-200 dark:border-gray-700/60 space-y-1.5">
            <p className="text-secondary">
              <strong className="text-gray-700 dark:text-gray-200">Average absolute error (MAE)</strong> is the
              mean absolute difference between recorded and predicted sales across the displayed periods.
            </p>
            <p className="text-secondary">
              <strong className="text-gray-700 dark:text-gray-200">Average absolute percentage error (MAPE)</strong>{' '}
              averages absolute percentage errors across displayed periods with non-zero actual sales; periods
              with zero actual sales are excluded because the percentage is undefined. This is not the same as
              accuracy.
            </p>
            <p className="text-secondary">{closeThresholdNote}</p>
            <p className="text-secondary">
              In the period breakdown, a positive "Predicted − actual" value means the prediction was higher
              than the recorded sales for that period; a negative value means it was lower.
            </p>
            <p className="text-secondary">
              See Model Comparison for the model's evaluation metrics across all stores.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Static "Actual sales" label with the toggle's own visual state (position +
// aria-checked) communicating visibility, rather than a label that itself
// changes text — matches the Dashboard's chart-header toggle convention.
function ComparisonSwitch({ showActual, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={showActual}
      onClick={onToggle}
      className={`flex items-center gap-2 px-3 rounded-xl text-xs font-semibold min-h-[44px]
                 transition-colors flex-shrink-0 focus:outline-none focus-visible:ring-2
                 focus-visible:ring-indigo-400 ${
        showActual
          ? 'bg-indigo-600 text-white'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      <span className={`relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full
                        transition-colors ${showActual ? 'bg-white/40' : 'bg-gray-400 dark:bg-gray-500'}`}>
        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow
                          transition-transform ${showActual ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
      </span>
      Actual sales
    </button>
  );
}

// Previous/Next stepper rather than a scrolling chip strip — the primary
// keyboard-accessible way to change the selected period. The chart's SVG
// dots and table rows stay clickable too, as convenience shortcuts to the
// same setSelectedPeriod handler.
function PeriodNavigator({ forecasts, effectivePeriod, forecastType, onSelect }) {
  const index = forecasts.findIndex(f => f.period === effectivePeriod);
  const atFirst = index <= 0;
  const atLast = index === -1 || index >= forecasts.length - 1;
  const navButtonClass = 'flex items-center gap-1 min-h-[44px] px-3 rounded-lg text-xs font-semibold ' +
    'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent ' +
    'focus:outline-none focus:ring-2 focus:ring-indigo-400';

  return (
    <div className="flex items-center justify-center gap-3 mt-2" role="group" aria-label="Step through forecast periods">
      <button
        type="button"
        onClick={() => !atFirst && onSelect(forecasts[index - 1].period)}
        disabled={atFirst}
        aria-label="Previous period"
        className={navButtonClass}
      >
        <ChevronLeft size={14} /> Previous
      </button>
      {/* aria-live announces the new selection to screen readers on click —
          hovering the chart never touches this state, so it never fires from
          a hover preview, only from an actual selection change. */}
      <span
        aria-live="polite"
        className="text-sm font-semibold text-gray-700 dark:text-gray-200 min-w-[9rem] text-center"
      >
        Selected: {formatShortPeriod(effectivePeriod, forecastType)}
      </span>
      <button
        type="button"
        onClick={() => !atLast && onSelect(forecasts[index + 1].period)}
        disabled={atLast}
        aria-label="Next period"
        className={navButtonClass}
      >
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
}

function ForecastTooltip({ active, payload, label, forecasts, forecastType, showActual }) {
  if (!active || !payload?.length) return null;
  const idx = forecasts.findIndex(f => f.period === label);
  const current = idx >= 0 ? forecasts[idx] : null;
  if (!current) return null;
  const previous = idx > 0 ? forecasts[idx - 1] : null;
  const change = describePeriodChange(current, previous);

  const hasActual = showActual && current.actual_sales != null;
  const diff = hasActual ? current.prediction - current.actual_sales : null;
  const ape = hasActual && current.actual_sales !== 0 ? (Math.abs(diff) / Math.abs(current.actual_sales)) * 100 : null;
  const direction = hasActual ? classifyResult(current.prediction, current.actual_sales) : null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700
                    shadow-lg px-4 py-3 text-xs min-w-[200px]">
      <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">
        {formatPeriodLabel(label, forecastType)}
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-500 dark:text-gray-400">Predicted sales</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">
            {Math.round(current.prediction).toLocaleString('en-US')}
          </span>
        </div>

        {!showActual && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-gray-500 dark:text-gray-400">Change from previous prediction</span>
            <span className="font-semibold text-gray-800 dark:text-gray-100">{change.text}</span>
          </div>
        )}

        {showActual && !hasActual && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-gray-500 dark:text-gray-400">Actual sales</span>
            <span className="font-semibold text-gray-800 dark:text-gray-100">Unavailable</span>
          </div>
        )}

        {hasActual && (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-500 dark:text-gray-400">Actual sales</span>
              <span className="font-semibold text-gray-800 dark:text-gray-100">
                {Math.round(current.actual_sales).toLocaleString('en-US')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-500 dark:text-gray-400">Predicted {MINUS} actual</span>
              <span className="font-semibold text-gray-800 dark:text-gray-100">
                {diff >= 0 ? '+' : MINUS}{Math.abs(Math.round(diff)).toLocaleString('en-US')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-500 dark:text-gray-400">Absolute % error</span>
              <span className="font-semibold text-gray-800 dark:text-gray-100">
                {current.actual_sales !== 0 ? `${ape.toFixed(1)}%` : 'Undefined'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-500 dark:text-gray-400">Direction</span>
              <span className="font-semibold text-gray-800 dark:text-gray-100">{direction}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The one place a period's full detail is shown — the chart's own SVG label,
// tooltip, and table row intentionally stay terse so this panel is the
// single source of "what does the selection mean" detail, per period.
function SelectedPeriodPanel({
  forecasts, effectivePeriod, requestedPeriod, forecastType, showActual, selectedStore, setActivePage, setHandoffPeriod,
}) {
  const idx = forecasts.findIndex(f => f.period === effectivePeriod);
  const current = forecasts[idx];
  const previous = idx > 0 ? forecasts[idx - 1] : null;
  const change = describePeriodChange(current, previous);

  const hasActual = showActual && current.actual_sales != null;
  const diff = hasActual ? current.prediction - current.actual_sales : null;
  const ape = hasActual && current.actual_sales !== 0 ? (Math.abs(diff) / Math.abs(current.actual_sales)) * 100 : null;
  const direction = hasActual ? classifyResult(current.prediction, current.actual_sales) : null;

  const requestedUnavailable = requestedPeriod && requestedPeriod !== effectivePeriod;

  return (
    <div className="card mb-6">
      <h2 className="card-title mb-1">Selected period</h2>
      <p className="text-secondary text-xs mb-2">
        Store {selectedStore} · {formatPeriodLabel(effectivePeriod, forecastType)}
      </p>

      {requestedUnavailable && (
        <p className="badge bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 mb-2 whitespace-normal text-left">
          The requested period isn't available for this store and forecast type — showing{' '}
          {formatShortPeriod(effectivePeriod, forecastType)} instead.
        </p>
      )}

      {/* Group 1: the period's own values. */}
      <dl className={`grid grid-cols-2 ${showActual ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3 text-xs`}>
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Predicted sales</dt>
          <dd className="font-semibold text-gray-800 dark:text-gray-100 mt-0.5 tabular-nums">
            {Math.round(current.prediction).toLocaleString('en-US')}
          </dd>
        </div>
        {showActual && (
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Actual sales</dt>
            <dd className="font-semibold text-gray-800 dark:text-gray-100 mt-0.5 tabular-nums">
              {hasActual ? Math.round(current.actual_sales).toLocaleString('en-US') : 'Unavailable'}
            </dd>
          </div>
        )}
      </dl>

      {/* Group 2: how this period's prediction compares to recorded sales —
          a distinct question from Group 3's forecast-over-time trend below. */}
      {showActual && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">
            Compared with recorded sales
          </p>
          <dl className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Predicted {MINUS} actual</dt>
              <dd className="font-semibold text-gray-800 dark:text-gray-100 mt-0.5 tabular-nums">
                {hasActual ? `${diff >= 0 ? '+' : MINUS}${Math.abs(Math.round(diff)).toLocaleString('en-US')}` : 'Unavailable'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Absolute % error</dt>
              <dd className="font-semibold text-gray-800 dark:text-gray-100 mt-0.5 tabular-nums">
                {hasActual ? (current.actual_sales !== 0 ? `${ape.toFixed(1)}%` : 'Undefined — zero actual sales') : 'Unavailable'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Direction</dt>
              <dd className="font-semibold text-gray-800 dark:text-gray-100 mt-0.5">
                {hasActual ? direction : 'Unavailable'}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* Group 3: this period's prediction vs. the previous period's
          prediction — a forecast-trend figure, not a prediction-error one. */}
      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">
          Compared with the previous prediction
        </p>
        <dl className="text-xs">
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Change from previous prediction</dt>
            <dd className="font-semibold text-gray-800 dark:text-gray-100 mt-0.5 tabular-nums">{change.text}</dd>
          </div>
        </dl>
      </div>

      {setActivePage && (
        <button
          type="button"
          onClick={() => { setHandoffPeriod?.(effectivePeriod); setActivePage('explanation'); }}
          className="mt-3 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded
                     min-h-[44px] px-1 -ml-1"
        >
          Explain this prediction →
        </button>
      )}
    </div>
  );
}

// ---- Main page ----

export default function ForecastChart({ selectedStore, forecastType, setActivePage, handoffPeriod, setHandoffPeriod }) {
  const cc = useChartColors();
  const isMobile = useIsMobile();
  const [showActual, setShowActual] = useState(false);
  const [zeroBased, setZeroBased] = useState(false);
  // Seeds from a period handed off by another page (e.g. Dashboard's "View
  // full forecast"), then behaves as ordinary local state — consumed once,
  // then cleared so a later direct visit to this page doesn't reuse it.
  const [selectedPeriod, setSelectedPeriod] = useState(() => handoffPeriod || null);
  useEffect(() => {
    if (handoffPeriod) setHandoffPeriod?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A selection made under one store/forecast-type context shouldn't leak
  // into a newly chosen one (periods are date strings that can coincidently
  // exist for a different store too) — reset on an actual change, but never
  // on first mount, so a handoff-seeded period is never immediately cleared.
  const contextKey = `${selectedStore}|${forecastType}`;
  const prevContextKeyRef = useRef(contextKey);
  useEffect(() => {
    if (prevContextKeyRef.current !== contextKey) {
      prevContextKeyRef.current = contextKey;
      setSelectedPeriod(null);
    }
  }, [contextKey]);

  const { data, loading, error, refetch } = useApi(
    () => client.get(`/forecast/${selectedStore}?forecast_type=${forecastType}`).then(res => res.data.forecasts),
    [selectedStore, forecastType],
    'Failed to load forecast data. Make sure the backend is running.'
  );

  const forecasts = data || [];
  const chartData = forecasts.map(f => ({
    period: f.period,
    Predicted: Math.round(f.prediction),
    Actual: f.actual_sales,
  }));

  // Pools Predicted + Actual regardless of the showActual toggle, so the
  // axis never visibly shifts when that toggle is switched — only when the
  // chart data or the zero-based mode itself changes.
  const yDomain = useMemo(() => {
    const values = seriesValues(chartData);
    return zeroBased ? niceDomain(values) : focusedDomain(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, zeroBased]);

  if (loading) return (
    <div className="animate-fadeIn">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
      <div className="mb-6"><SkeletonChart height={320} /></div>
      <SkeletonTable rows={6} cols={5} />
    </div>
  );

  if (error) return <AlertBanner variant="error" onRetry={refetch}>{error}</AlertBanner>;

  if (forecasts.length === 0) return (
    <EmptyState
      title="No forecasts for this store"
      message="There are no precomputed predictions for the selected store and forecast type."
    />
  );

  const latestPeriod = forecasts[forecasts.length - 1].period;
  const effectivePeriod = (selectedPeriod && forecasts.some(f => f.period === selectedPeriod))
    ? selectedPeriod
    : latestPeriod;

  const predictions = forecasts.map(f => f.prediction);
  const totalPredicted = predictions.reduce((s, v) => s + v, 0);
  const avgPredicted = totalPredicted / forecasts.length;
  const maxPredictedRow = forecasts.reduce((best, f) => (f.prediction > best.prediction ? f : best), forecasts[0]);
  const minPredictedRow = forecasts.reduce((best, f) => (f.prediction < best.prediction ? f : best), forecasts[0]);

  const rowsWithActual = forecasts.filter(f => f.actual_sales != null);
  const missingActualCount = forecasts.length - rowsWithActual.length;
  const zeroActualCount = rowsWithActual.filter(f => f.actual_sales === 0).length;
  const totalActual = rowsWithActual.reduce((s, f) => s + f.actual_sales, 0);
  const mae = computeMAE(forecasts);
  const mape = computeMAPE(forecasts);

  const rowMetrics = forecasts.map((f, i) => {
    const previous = i > 0 ? forecasts[i - 1] : null;
    const change = describePeriodChange(f, previous);
    const hasActual = f.actual_sales != null;
    const diff = hasActual ? f.prediction - f.actual_sales : null;
    const ape = hasActual && f.actual_sales !== 0 ? (Math.abs(diff) / Math.abs(f.actual_sales)) * 100 : null;
    const direction = hasActual ? classifyResult(f.prediction, f.actual_sales) : null;

    return {
      period: f.period,
      periodLabel: formatTablePeriod(f.period, forecastType),
      predictedLabel: Math.round(f.prediction).toLocaleString('en-US'),
      changeLabel: change.text,
      hasActual,
      actualLabel: hasActual ? Math.round(f.actual_sales).toLocaleString('en-US') : 'Unavailable',
      differenceLabel: hasActual ? `${diff >= 0 ? '+' : MINUS}${Math.abs(Math.round(diff)).toLocaleString('en-US')}` : 'Unavailable',
      apeLabel: hasActual ? (f.actual_sales !== 0 ? `${ape.toFixed(1)}%` : 'Undefined — zero actual') : 'Unavailable',
      direction,
    };
  });

  // The shared `cc.chart.actual`/`cc.chart.predicted` tokens hold an indigo
  // and an orange value respectively — reassigned by colour, not by token
  // name, to match the Dashboard's established pairing (solid indigo for
  // Predicted, dashed blue-grey for Actual).
  const predictedColor = cc.chart.actual;
  const actualColor = cc.axisLabel;

  const mobileTickIndices = isMobile ? pickEvenIndices(forecasts.length, 4) : null;
  const xTickFormatter = forecastType === 'weekly'
    ? (period) => DAY_MONTH_SHORT_FMT.format(toDate(period))
    : (period) => SHORT_MONTH_YEAR_FMT.format(toDate(period));

  const dateRange = formatDateRange(forecasts.map(f => f.period), forecastType);
  const typeLabel = forecastType === 'weekly' ? 'Weekly' : 'Monthly';

  const handleDownload = () => {
    const csv = buildCsv(forecasts, forecastType, showActual);
    downloadCsv(csv, `forecast_store${selectedStore}_${forecastType}${showActual ? '_comparison' : ''}.csv`);
  };

  const maeUnavailableText = mae == null ? `Unavailable — ${unavailableReason(forecasts)}` : null;
  const mapeUnavailableText = mape == null ? `Unavailable — ${unavailableReason(forecasts, { requireNonZero: true })}` : null;

  // Concise, data-driven scope line — never a hard-coded store/date/count —
  // replacing the earlier generic "not a measure of overall performance"
  // wording with a statement that names what's actually being summarised.
  const periodUnit = forecastType === 'weekly' ? 'week' : 'month';
  const periodNoun = forecasts.length === 1 ? periodUnit : `${periodUnit}s`;
  const scopeText = showActual
    ? `Error metrics reflect Store ${selectedStore}'s ${forecasts.length} displayed ${periodNoun} of comparison.`
    : `Summary for Store ${selectedStore} across ${forecasts.length} displayed ${periodNoun}.`;

  return (
    <div className="animate-fadeIn">
      <PageHeader
        icon={TrendingUp}
        title={`Forecast Analysis — Store ${selectedStore}`}
        subtitle={`Historical test predictions · ${typeLabel} · ${dateRange} · ${forecasts.length} periods`}
        className="mb-4"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-2">
        {!showActual ? (
          <>
            <KpiCard
              label="Total predicted sales"
              value={Math.round(totalPredicted).toLocaleString('en-US')}
              icon={TrendingUp}
              tone="primary"
              sublabel={`Across ${forecasts.length} ${forecastType} predictions`}
            />
            <KpiCard
              dense
              label="Average prediction"
              value={Math.round(avgPredicted).toLocaleString('en-US')}
              icon={BarChart3}
              tone="neutral"
              sublabel={forecastType === 'weekly' ? 'Average per week' : 'Average per month'}
            />
            <KpiCard
              dense
              label="Highest prediction"
              value={Math.round(maxPredictedRow.prediction).toLocaleString('en-US')}
              icon={ArrowUp}
              tone="neutral"
              sublabel={formatShortPeriod(maxPredictedRow.period, forecastType)}
            />
            <KpiCard
              dense
              label="Lowest prediction"
              value={Math.round(minPredictedRow.prediction).toLocaleString('en-US')}
              icon={ArrowDown}
              tone="neutral"
              sublabel={formatShortPeriod(minPredictedRow.period, forecastType)}
            />
          </>
        ) : (
          <>
            <KpiCard
              label="Total predicted sales"
              value={Math.round(totalPredicted).toLocaleString('en-US')}
              icon={TrendingUp}
              tone="primary"
              sublabel={`Across all ${forecasts.length} displayed periods`}
            />
            <KpiCard
              dense
              label="Total actual sales"
              value={Math.round(totalActual).toLocaleString('en-US')}
              icon={BarChart3}
              tone="neutral"
              sublabel={missingActualCount > 0
                ? `Across ${rowsWithActual.length} of ${forecasts.length} periods with recorded sales`
                : `Across ${rowsWithActual.length} ${forecastType} periods`}
            />
            <KpiCard
              dense
              label="Average absolute error"
              value={mae != null ? Math.round(mae).toLocaleString('en-US') : maeUnavailableText}
              icon={Activity}
              tone="neutral"
              tooltip="Also known as MAE (Mean Absolute Error): the mean absolute difference between recorded and predicted sales across the displayed periods."
            />
            <KpiCard
              dense
              label="Average absolute percentage error"
              value={mape != null ? `${mape.toFixed(1)}%` : mapeUnavailableText}
              icon={Percent}
              tone="neutral"
              tooltip={`Also known as MAPE (Mean Absolute Percentage Error). Excludes periods with zero actual sales (${zeroActualCount} excluded here) because the percentage is undefined. This is not accuracy — 100% minus MAPE is not a valid accuracy figure.`}
            />
          </>
        )}
      </div>

      <p className="text-secondary text-xs mb-6">
        {scopeText}
        {showActual && missingActualCount > 0 && (
          <> Recorded sales are unavailable for {missingActualCount} of {forecasts.length} periods; totals compare
            the {rowsWithActual.length} matching periods only.</>
        )}
      </p>

      <div className="card mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <div>
            <h2 className="card-title">
              {showActual ? 'Predicted and actual sales over time' : 'Predicted sales over time'}
            </h2>
            <p className="text-secondary text-xs mt-0.5">
              {forecasts.length} {forecastType} predictions · {dateRange}
            </p>
          </div>
          <ComparisonSwitch showActual={showActual} onToggle={() => setShowActual(s => !s)} />
        </div>

        <div className="h-72 mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 4, bottom: 26 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
              <XAxis
                dataKey="period"
                interval={0}
                padding={{ left: 12, right: 12 }}
                tick={mobileTickIndices
                  ? (p) => (!mobileTickIndices.has(p.index) ? null : (
                      <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize={11} fill={cc.axisTick}>
                        {xTickFormatter(p.payload.value)}
                      </text>
                    ))
                  : { fontSize: 11, fill: cc.axisTick }}
                tickFormatter={xTickFormatter}
                label={{
                  value: forecastType === 'weekly' ? 'Week beginning' : 'Month',
                  position: 'insideBottom', offset: -8, fill: cc.axisLabel, fontSize: 11,
                }}
              />
              <YAxis
                domain={yDomain}
                tickCount={6}
                width={52}
                tick={{ fontSize: 11, fill: cc.axisTick }}
                tickFormatter={v => compactNumber.format(v)}
                label={{
                  value: 'Sales value', angle: -90, position: 'insideLeft', fill: cc.axisLabel, fontSize: 11,
                }}
              />
              <Tooltip content={<ForecastTooltip forecasts={forecasts} forecastType={forecastType} showActual={showActual} />} />
              {showActual && (
                <Line type="linear" dataKey="Actual" stroke={actualColor} strokeWidth={2}
                      strokeDasharray="6 3" dot={{ r: 3, fill: actualColor, strokeWidth: 0 }}
                      isAnimationActive={false} />
              )}
              <Line
                type="linear"
                dataKey="Predicted"
                stroke={predictedColor}
                strokeWidth={2.5}
                isAnimationActive={false}
                // The persistent selected marker (a solid filled disc with a
                // background-colour halo) is drawn here, independent of
                // hover — it never moves or disappears while a different
                // point is hovered. The hover preview uses a visually
                // distinct hollow-ring `activeDot` below, so a reader can
                // never mistake "what I'm hovering" for "what is selected".
                dot={(dotProps) => {
                  if (!dotProps.payload) return null;
                  const isSelected = dotProps.payload.period === effectivePeriod;
                  return (
                    <circle
                      key={`dot-${dotProps.payload.period}`}
                      cx={dotProps.cx} cy={dotProps.cy} r={isSelected ? 6 : 3}
                      fill={predictedColor}
                      stroke={isSelected ? cc.tooltip.background : 'none'}
                      strokeWidth={isSelected ? 2 : 0}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedPeriod(dotProps.payload.period)}
                    />
                  );
                }}
                activeDot={{ r: 5, fill: cc.tooltip.background, stroke: predictedColor, strokeWidth: 2 }}
                label={(labelProps) => {
                  if (labelProps.value == null || !labelProps.payload || labelProps.payload.period !== effectivePeriod) return null;
                  return (
                    <text x={labelProps.x} y={labelProps.y - 14} textAnchor="middle" fontSize={11}
                          fontWeight={600} fill={predictedColor}>
                      {Math.round(labelProps.value).toLocaleString('en-US')}
                    </text>
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 mt-2 flex-wrap">
          <span className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="16" y2="4" stroke={predictedColor} strokeWidth="2" />
            </svg>
            Predicted sales
          </span>
          {showActual && (
            <span className="flex items-center gap-1.5">
              <svg width="16" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="16" y2="4" stroke={actualColor} strokeWidth="2" strokeDasharray="4 2" />
              </svg>
              Actual sales
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {yDomain[0] > 0 && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Y-axis starts at {compactNumber.format(yDomain[0])}, not zero.
            </p>
          )}
          <button
            type="button"
            onClick={() => setZeroBased(z => !z)}
            aria-pressed={zeroBased}
            className="text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-indigo-600
                       dark:hover:text-indigo-400 focus:outline-none focus-visible:ring-2
                       focus-visible:ring-indigo-400 rounded min-h-[44px] px-1 ml-auto"
          >
            {zeroBased ? 'Show focused range' : 'Start at zero'}
          </button>
        </div>

        <PeriodNavigator
          forecasts={forecasts}
          effectivePeriod={effectivePeriod}
          forecastType={forecastType}
          onSelect={setSelectedPeriod}
        />
      </div>

      <SelectedPeriodPanel
        forecasts={forecasts}
        effectivePeriod={effectivePeriod}
        requestedPeriod={selectedPeriod}
        forecastType={forecastType}
        showActual={showActual}
        selectedStore={selectedStore}
        setActivePage={setActivePage}
        setHandoffPeriod={setHandoffPeriod}
      />

      <div className="card mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="section-title mb-0">Period breakdown</h2>
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400
                       hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
                       rounded min-h-[44px] px-2"
          >
            <Download size={14} aria-hidden="true" /> Download displayed data
          </button>
        </div>

        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th scope="col" className="px-3 py-2 text-left rounded-l-xl whitespace-nowrap">
                  {forecastType === 'weekly' ? 'Week beginning' : 'Month'}
                </th>
                {!showActual ? (
                  <>
                    <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">Predicted sales</th>
                    <th scope="col" className="px-3 py-2 text-right rounded-r-xl whitespace-nowrap">Change from previous prediction</th>
                  </>
                ) : (
                  <>
                    <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">Predicted sales</th>
                    <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">Actual sales</th>
                    <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">
                      Predicted {MINUS} actual
                      <HeaderHint text="Positive means the prediction was higher than recorded sales; negative means it was lower." />
                    </th>
                    <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">
                      Absolute % error
                      <HeaderHint text="The absolute difference as a percentage of actual sales. Undefined when actual sales are zero." />
                    </th>
                    <th scope="col" className="px-3 py-2 text-left rounded-r-xl whitespace-nowrap">
                      Direction
                      <HeaderHint text="Above actual: the prediction was higher than recorded sales. Below actual: lower. Matches actual: exactly equal. This is a factual label, not a validated measure of forecast quality." />
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rowMetrics.map((row) => {
                const isSelected = row.period === effectivePeriod;
                return (
                  <tr
                    key={row.period}
                    className={`table-row cursor-pointer focus:outline-none focus-visible:ring-2
                               focus-visible:ring-inset focus-visible:ring-indigo-400 ${
                      isSelected ? 'bg-indigo-50 dark:bg-indigo-500/10' : ''
                    }`}
                    tabIndex={0}
                    aria-selected={isSelected}
                    onClick={() => setSelectedPeriod(row.period)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedPeriod(row.period); }
                    }}
                  >
                    <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">{row.periodLabel}</td>
                    {!showActual ? (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                          {row.predictedLabel}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {row.changeLabel}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                          {row.predictedLabel}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-800 dark:text-gray-100 whitespace-nowrap">
                          {row.actualLabel}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {row.differenceLabel}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {row.apeLabel}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {row.direction ? (
                            <span className={`badge whitespace-nowrap ${DIRECTION_BADGE[row.direction] || ''}`}>{row.direction}</span>
                          ) : (
                            <span className="badge whitespace-nowrap bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">Unavailable</span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="sm:hidden space-y-2">
          {rowMetrics.map((row) => {
            const isSelected = row.period === effectivePeriod;
            return (
              <div
                key={row.period}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => setSelectedPeriod(row.period)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedPeriod(row.period); }
                }}
                className={`rounded-xl border px-4 py-3 text-xs cursor-pointer focus:outline-none
                           focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  isSelected
                    ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-500/40 dark:bg-indigo-500/10'
                    : 'border-gray-100 dark:border-gray-700/60'
                }`}
              >
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1.5">
                  {forecastType === 'weekly' ? 'Week beginning ' : ''}{row.periodLabel}
                </p>
                <div className="space-y-1 text-gray-600 dark:text-gray-300">
                  <div className="flex justify-between">
                    <span>Predicted</span><span className="tabular-nums font-medium">{row.predictedLabel}</span>
                  </div>
                  {!showActual ? (
                    <div className="flex justify-between">
                      <span>Change</span><span className="tabular-nums">{row.changeLabel}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between"><span>Actual</span><span className="tabular-nums">{row.actualLabel}</span></div>
                      <div className="flex justify-between"><span>Difference</span><span className="tabular-nums">{row.differenceLabel}</span></div>
                      <div className="flex justify-between"><span>Percentage error</span><span className="tabular-nums">{row.apeLabel}</span></div>
                      <div className="flex justify-between"><span>Direction</span><span>{row.direction || 'Unavailable'}</span></div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AboutSection
        forecastType={forecastType}
        closeThresholdNote={'"Matches actual" means the prediction exactly equalled recorded sales — there is no tolerance window.'}
      />
    </div>
  );
}
