import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, BarChart3, ArrowUp, ArrowDown, Zap, Target, Download, Info, ChevronLeft, ChevronRight,
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

// Full-length formatters (table cells, tooltips, the date-range context badge).
const FULL_DATE_FMT        = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const MONTH_YEAR_FMT       = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const DAY_MONTH_FMT        = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });
const MONTH_ONLY_FMT       = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const SHORT_DATE_FMT       = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
// Abbreviated formatters (chart X-axis ticks only — compact spacing).
const DAY_MONTH_SHORT_FMT  = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const SHORT_MONTH_YEAR_FMT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

// These two thresholds are interface interpretation rules for this page's
// Trend/Result labelling only — a display convention chosen to make the
// breakdown table and tooltip scannable. They are NOT model-evaluation
// standards: the model's actual accuracy is reported elsewhere (the test-set
// MAE/RMSE/MAPE/RMSPE in the model comparison metadata, and this page's own
// Displayed-period MAE/MAPE KPIs), and neither of those come from these
// thresholds or are affected by them. Keep this note in sync with the
// column-header tooltips below, which surface the same distinction to users.
const TREND_THRESHOLD_PCT = 1;
const CLOSE_FORECAST_THRESHOLD_PCT = 2;

// Real minus sign (U+2212), not the ASCII hyphen-minus that Number.toFixed
// produces — used everywhere a negative value is shown (table, tooltip, CSV).
const MINUS = '−';

const RESULT_BADGE = {
  'Over forecast' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400',
  'Under forecast': 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400',
  'Close forecast': 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

// Compact glyph for the Trend column — "Change from previous" already states
// the direction and magnitude as a percentage, so Trend is a quick-scan icon
// rather than a second text repetition of the same fact.
const TREND_BADGE = {
  'Starting period'    : { symbol: '–', className: 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500' },
  'Increase'           : { symbol: '↑', className: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400' },
  'Decrease'           : { symbol: '↓', className: 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400' },
  'No material change' : { symbol: '→', className: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
};

function TrendBadge({ trend }) {
  const { symbol, className } = TREND_BADGE[trend];
  return (
    <span className={`badge inline-flex items-center justify-center w-6 ${className}`} title={trend}>
      <span aria-hidden="true">{symbol}</span>
      <span className="sr-only">{trend}</span>
    </span>
  );
}

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
// 1/2/4/5/6/8/10 x 10^n step.
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

export function computeChange(current, previous) {
  if (!previous || !previous.prediction) return null;
  const pct = ((current.prediction - previous.prediction) / Math.abs(previous.prediction)) * 100;
  return { pct, direction: current.prediction >= previous.prediction ? 'up' : 'down' };
}

export function classifyTrend(pct) {
  if (Math.abs(pct) < TREND_THRESHOLD_PCT) return 'No material change';
  return pct >= 0 ? 'Increase' : 'Decrease';
}

// difference is always predicted − actual. Diff === 0 is trivially a close
// forecast; otherwise a forecast within CLOSE_FORECAST_THRESHOLD_PCT of the
// actual value (by absolute percentage error) also counts as close — the
// threshold is surfaced in the Result column's header tooltip, not silent.
export function classifyResult(predicted, actual) {
  const diff = predicted - actual;
  if (diff === 0) return 'Close forecast';
  const ape = actual !== 0 ? (Math.abs(diff) / Math.abs(actual)) * 100 : null;
  if (ape != null && ape <= CLOSE_FORECAST_THRESHOLD_PCT) return 'Close forecast';
  return diff > 0 ? 'Over forecast' : 'Under forecast';
}

export function computeMAE(forecasts) {
  const eligible = forecasts.filter(f => f.actual_sales != null);
  if (!eligible.length) return null;
  const total = eligible.reduce((sum, f) => sum + Math.abs(f.actual_sales - f.prediction), 0);
  return total / eligible.length;
}

// Rows with zero actual sales are excluded (division by zero) — disclosed
// via the KPI card's tooltip prop, not silently dropped.
export function computeMAPE(forecasts) {
  const eligible = forecasts.filter(f => f.actual_sales != null && f.actual_sales !== 0);
  if (!eligible.length) return null;
  const total = eligible.reduce((sum, f) => sum + Math.abs(f.actual_sales - f.prediction) / Math.abs(f.actual_sales), 0);
  return (total / eligible.length) * 100;
}

export function buildForecastSummary(forecasts, forecastType) {
  if (!forecasts || forecasts.length === 0) return '';
  const predictions = forecasts.map(f => f.prediction);
  const min = Math.min(...predictions);
  const max = Math.max(...predictions);
  const maxRow = forecasts.find(f => f.prediction === max);
  const unit = forecastType === 'weekly' ? 'weeks' : 'months';
  const periodPhrase = forecastType === 'weekly'
    ? `the week beginning ${formatFullDate(maxRow.period)}`
    : formatMonthlyPeriod(maxRow.period);
  return `Predicted sales range from ${Math.round(min).toLocaleString('en-US')} to ${Math.round(max).toLocaleString('en-US')} `
    + `across ${forecasts.length} ${unit}. The highest forecast occurs during ${periodPhrase}.`;
}

export function buildComparisonSummary(forecasts) {
  if (!forecasts || forecasts.length === 0) return '';
  const withActual = forecasts.filter(f => f.actual_sales != null);
  const higherCount = withActual.filter(f => f.prediction > f.actual_sales).length;
  const mape = computeMAPE(forecasts);
  const mapeText = mape != null ? `${mape.toFixed(1)}%` : 'unavailable';
  return `Predictions were higher than actual sales in ${higherCount} of ${withActual.length} periods. `
    + `The displayed-period MAPE is ${mapeText}.`;
}

function csvEscape(value) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function buildCsv(forecasts, forecastType, showActual) {
  const headers = showActual
    ? ['Period', 'Predicted Sales', 'Actual Sales', 'Difference', 'Absolute Percentage Error']
    : ['Period', 'Predicted Sales'];
  const lines = [headers.join(',')];
  forecasts.forEach((f) => {
    const label = csvEscape(formatPeriodLabel(f.period, forecastType));
    const predicted = Math.round(f.prediction);
    if (!showActual) {
      lines.push([label, predicted].join(','));
      return;
    }
    const hasActual = f.actual_sales != null;
    const actual = hasActual ? Math.round(f.actual_sales) : '';
    const diff = hasActual ? predicted - actual : null;
    const diffLabel = hasActual ? `${diff >= 0 ? '+' : MINUS}${Math.abs(diff)}` : '';
    const ape = hasActual && actual !== 0 ? `${((Math.abs(diff) / Math.abs(actual)) * 100).toFixed(1)}%` : '';
    lines.push([label, predicted, actual, diffLabel, ape].join(','));
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

function AboutSection({ forecastType }) {
  const steps = [
    { title: 'View the forecast', desc: `Examine ${forecastType} predicted sales.` },
    { title: 'Compare with actuals', desc: 'Reveal historical actual sales to evaluate model performance.' },
    { title: 'Inspect each period', desc: 'Select a chart point or table row to review its values and error.' },
  ];
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-700/60 bg-gray-50/60
                    dark:bg-gray-800/40 px-5 py-3 mb-6">
      <div className="flex items-center gap-2 mb-1.5">
        <Info size={14} className="text-indigo-500 dark:text-indigo-400 flex-shrink-0" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">About this forecast analysis</h2>
      </div>
      <p className="text-secondary text-xs mb-1.5 max-w-3xl">
        This page presents precomputed XGBoost sales predictions for the selected store. Start with the
        forecast-only view, optionally reveal actual sales for retrospective evaluation, and inspect each
        period in the chart or breakdown table.
      </p>

      {/* The three steps live only inside this collapsed-by-default accordion
          on every breakpoint — kept the intro paragraph always visible above
          it, since that's the part worth reading unprompted; the walkthrough
          is opt-in detail, not something that should push the chart down the
          page on a laptop screen. */}
      <details className="text-xs mb-1.5">
        <summary className="cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
          How to use this page
        </summary>
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {steps.map(step => (
            <div key={step.title}>
              <dt className="font-semibold text-gray-700 dark:text-gray-200">{step.title}</dt>
              <dd className="text-secondary mt-0.5">{step.desc}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="text-secondary text-xs">
        These are historical test predictions. The model is not retrained when this page loads.
      </p>
    </div>
  );
}

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
      {showActual ? 'Hide actual sales' : 'Show actual sales'}
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
    <div className="flex items-center justify-center gap-3 mt-3" role="group" aria-label="Step through forecast periods">
      <button
        type="button"
        onClick={() => !atFirst && onSelect(forecasts[index - 1].period)}
        disabled={atFirst}
        aria-label="Previous period"
        className={navButtonClass}
      >
        <ChevronLeft size={14} /> Previous
      </button>
      <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 min-w-[6.5rem] text-center">
        {formatShortPeriod(effectivePeriod, forecastType)}
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
  const previous = idx > 0 ? forecasts[idx - 1] : null;
  const predicted = payload.find(p => p.dataKey === 'Predicted')?.value;
  const actual = showActual ? payload.find(p => p.dataKey === 'Actual')?.value : undefined;
  const periodLabel = forecastType === 'weekly' ? 'Week beginning' : 'Month';
  const change = current ? computeChange(current, previous) : null;

  const hasActual = showActual && actual != null;
  let diff, ape, result;
  if (hasActual && predicted != null) {
    diff = predicted - actual;
    ape = actual !== 0 ? (Math.abs(diff) / Math.abs(actual)) * 100 : null;
    result = classifyResult(predicted, actual);
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700
                    shadow-lg px-4 py-3 text-xs min-w-[200px]">
      <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">
        {periodLabel}: {formatFullDate(label)}
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-500 dark:text-gray-400">Predicted sales</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">
            {predicted != null ? Math.round(predicted).toLocaleString('en-US') : '—'}
          </span>
        </div>

        {!showActual && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-gray-500 dark:text-gray-400">Change from previous period</span>
            <span className="font-semibold text-gray-800 dark:text-gray-100">
              {change ? `${change.pct >= 0 ? '+' : MINUS}${Math.abs(change.pct).toFixed(1)}%` : 'Starting period'}
            </span>
          </div>
        )}

        {showActual && !hasActual && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-gray-500 dark:text-gray-400">Actual sales</span>
            <span className="font-semibold text-gray-800 dark:text-gray-100">Not available</span>
          </div>
        )}

        {hasActual && (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-500 dark:text-gray-400">Actual sales</span>
              <span className="font-semibold text-gray-800 dark:text-gray-100">{Math.round(actual).toLocaleString('en-US')}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-500 dark:text-gray-400">Difference</span>
              <span className="font-semibold text-gray-800 dark:text-gray-100">
                {diff >= 0 ? '+' : MINUS}{Math.abs(Math.round(diff)).toLocaleString('en-US')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-500 dark:text-gray-400">Absolute % error</span>
              <span className="font-semibold text-gray-800 dark:text-gray-100">
                {ape != null ? `${ape.toFixed(1)}%` : 'N/A'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-500 dark:text-gray-400">Result</span>
              <span className="font-semibold text-gray-800 dark:text-gray-100">{result}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Main page ----

export default function ForecastChart({ selectedStore, forecastType }) {
  const cc = useChartColors();
  const isMobile = useIsMobile();
  const [showActual, setShowActual] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState(null);

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

  const yDomain = useMemo(() => {
    const values = chartData.flatMap(d => (showActual && d.Actual != null) ? [d.Predicted, d.Actual] : [d.Predicted]);
    return niceDomain(values);
  }, [chartData, showActual]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const totalActual = rowsWithActual.reduce((s, f) => s + f.actual_sales, 0);
  const mae = computeMAE(forecasts);
  const mape = computeMAPE(forecasts);

  const rowMetrics = forecasts.map((f, i) => {
    const previous = i > 0 ? forecasts[i - 1] : null;
    const predicted = Math.round(f.prediction);
    const change = previous ? computeChange(f, previous) : null;
    const changeLabel = !previous ? 'Starting period' : (change ? `${change.pct >= 0 ? '+' : MINUS}${Math.abs(change.pct).toFixed(1)}%` : 'N/A');
    const trend = !previous ? 'Starting period' : (change ? classifyTrend(change.pct) : 'No material change');

    const hasActual = f.actual_sales != null;
    const actual = hasActual ? Math.round(f.actual_sales) : null;
    const diff = hasActual ? predicted - actual : null;
    const ape = hasActual && actual !== 0 ? (Math.abs(diff) / Math.abs(actual)) * 100 : null;

    return {
      period: f.period,
      periodLabel: formatPeriodLabel(f.period, forecastType),
      predictedLabel: predicted.toLocaleString('en-US'),
      changeLabel,
      trend,
      actualLabel: hasActual ? actual.toLocaleString('en-US') : 'N/A',
      differenceLabel: hasActual ? `${diff >= 0 ? '+' : MINUS}${Math.abs(diff).toLocaleString('en-US')}` : 'N/A',
      apeLabel: hasActual ? (actual !== 0 ? `${ape.toFixed(1)}%` : 'N/A — zero actual sales') : 'N/A',
      result: hasActual ? classifyResult(predicted, actual) : null,
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

  const handleDownload = () => {
    const csv = buildCsv(forecasts, forecastType, showActual);
    downloadCsv(csv, `forecast_store${selectedStore}_${forecastType}.csv`);
  };

  return (
    <div className="animate-fadeIn">
      <PageHeader
        icon={TrendingUp}
        title={`Forecast Analysis — Store ${selectedStore}`}
        subtitle={`Explore ${forecasts.length} precomputed ${forecastType} predictions across the historical evaluation period.`}
      />

      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400 mb-6 -mt-2">
        <span className="badge bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {forecastType === 'weekly' ? 'Weekly' : 'Monthly'}
        </span>
        <span aria-hidden="true">·</span>
        <span>{dateRange}</span>
        <span aria-hidden="true">·</span>
        <span className="badge bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">XGBoost</span>
        <span aria-hidden="true">·</span>
        <span className="badge bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">Historical test predictions</span>
      </div>

      <AboutSection forecastType={forecastType} />

      <div className="flex items-center justify-between gap-3 flex-wrap mb-6" aria-live="polite">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-secondary text-xs">
            {showActual
              ? 'Actual sales are displayed for retrospective model evaluation only. They were not used as model inputs or sent to the recommendation system.'
              : 'Viewing predicted sales only. Actual sales remain hidden until retrospective comparison is enabled.'}
          </p>
          {showActual && (
            <span className="badge bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
              Historical evaluation
            </span>
          )}
        </div>
        <ComparisonSwitch showActual={showActual} onToggle={() => setShowActual(s => !s)} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
              label="Average prediction"
              value={Math.round(avgPredicted).toLocaleString('en-US')}
              icon={BarChart3}
              tone="neutral"
              sublabel={forecastType === 'weekly' ? 'Average per week' : 'Average per month'}
            />
            <KpiCard
              label="Highest forecast"
              value={Math.round(maxPredictedRow.prediction).toLocaleString('en-US')}
              icon={ArrowUp}
              tone="success"
              sublabel={formatShortPeriod(maxPredictedRow.period, forecastType)}
            />
            <KpiCard
              label="Lowest forecast"
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
              sublabel={`Across ${forecasts.length} ${forecastType} predictions`}
            />
            <KpiCard
              label="Total actual sales"
              value={Math.round(totalActual).toLocaleString('en-US')}
              icon={BarChart3}
              tone="neutral"
              sublabel={`Across ${rowsWithActual.length} ${forecastType} periods`}
            />
            <KpiCard
              label="Displayed-period MAE"
              value={mae != null ? Math.round(mae).toLocaleString('en-US') : 'N/A'}
              icon={Zap}
              tone="neutral"
              tooltip="Mean absolute difference between actual and predicted sales across the periods currently displayed."
            />
            <KpiCard
              label="Displayed-period MAPE"
              value={mape != null ? `${mape.toFixed(1)}%` : 'N/A — all periods have zero actual sales'}
              icon={Target}
              tone="neutral"
              tooltip="Mean absolute percentage error across displayed periods with non-zero actual sales. Periods with zero actual sales are excluded."
            />
          </>
        )}
      </div>

      <div className="card mb-6">
        <div className="mb-1">
          <h2 className="card-title">
            {showActual ? 'Predicted and actual sales over time' : 'Predicted sales over time'}
          </h2>
          <p className="text-secondary text-xs mt-0.5">
            {forecasts.length} {forecastType} predictions · {dateRange}
          </p>
        </div>

        <div className="h-72 mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 26 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
              <XAxis
                dataKey="period"
                interval={0}
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
              <Area type="linear" dataKey="Predicted" stroke="none" fill={predictedColor}
                    fillOpacity={0.08} isAnimationActive={false} />
              {showActual && (
                <Line type="linear" dataKey="Actual" stroke={actualColor} strokeWidth={2}
                      strokeDasharray="6 3" dot={{ r: 3, fill: actualColor, strokeWidth: 0 }}
                      isAnimationActive={false} connectNulls />
              )}
              <Line
                type="linear"
                dataKey="Predicted"
                stroke={predictedColor}
                strokeWidth={2.5}
                isAnimationActive={false}
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

        <PeriodNavigator
          forecasts={forecasts}
          effectivePeriod={effectivePeriod}
          forecastType={forecastType}
          onSelect={setSelectedPeriod}
        />

        <p className="text-secondary text-xs mt-3">
          {showActual ? buildComparisonSummary(forecasts) : buildForecastSummary(forecasts, forecastType)}
        </p>
      </div>

      <div className="card">
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
                <th scope="col" className="px-4 py-2 text-left rounded-l-xl">Period</th>
                {!showActual ? (
                  <>
                    <th scope="col" className="px-4 py-2 text-right">Predicted sales</th>
                    <th scope="col" className="px-4 py-2 text-right">Change from previous</th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-center rounded-r-xl"
                      title={`Quick-scan direction for the change in the previous column. A change of less than ${TREND_THRESHOLD_PCT}% is shown as no material change.`}
                    >
                      Trend
                    </th>
                  </>
                ) : (
                  <>
                    <th scope="col" className="px-4 py-2 text-right">Predicted</th>
                    <th scope="col" className="px-4 py-2 text-right">Actual</th>
                    <th scope="col" className="px-4 py-2 text-right">Difference</th>
                    <th scope="col" className="px-4 py-2 text-right">Absolute % error</th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-left rounded-r-xl"
                      title={`"Close forecast" means an absolute percentage error of ${CLOSE_FORECAST_THRESHOLD_PCT}% or less — an interface interpretation rule for this page's display, not a model-evaluation standard.`}
                    >
                      Result
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
                    <td className="px-4 py-2 font-medium text-gray-700 dark:text-gray-200">{row.periodLabel}</td>
                    {!showActual ? (
                      <>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-indigo-600 dark:text-indigo-400">
                          {row.predictedLabel}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">
                          {row.changeLabel}
                        </td>
                        <td className="px-4 py-2 text-center"><TrendBadge trend={row.trend} /></td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-indigo-600 dark:text-indigo-400">
                          {row.predictedLabel}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-800 dark:text-gray-100">
                          {row.actualLabel}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">
                          {row.differenceLabel}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
                          {row.apeLabel}
                        </td>
                        <td className="px-4 py-2">
                          {row.result && (
                            <span className={`badge ${RESULT_BADGE[row.result] || ''}`}>{row.result}</span>
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
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1.5">{row.periodLabel}</p>
                <div className="space-y-1 text-gray-600 dark:text-gray-300">
                  <div className="flex justify-between">
                    <span>Predicted</span><span className="tabular-nums font-medium">{row.predictedLabel}</span>
                  </div>
                  {!showActual ? (
                    <div className="flex justify-between items-center">
                      <span>Change</span>
                      <span className="flex items-center gap-1.5">
                        <span className="tabular-nums">{row.changeLabel}</span>
                        <TrendBadge trend={row.trend} />
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between"><span>Actual</span><span className="tabular-nums">{row.actualLabel}</span></div>
                      <div className="flex justify-between"><span>Difference</span><span className="tabular-nums">{row.differenceLabel}</span></div>
                      <div className="flex justify-between"><span>Percentage error</span><span className="tabular-nums">{row.apeLabel}</span></div>
                      <div className="flex justify-between"><span>Result</span><span>{row.result || 'N/A'}</span></div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
