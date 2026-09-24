import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  LayoutDashboard, TrendingUp, ArrowUp, ArrowDown, ChevronLeft, ChevronRight,
} from 'lucide-react';
import client from '../../api/client';
import { getFeatureLabel } from '../../lib/featureLabels';
import { useApi } from '../../hooks/useApi';
import { useChartColors } from '../../hooks/useChartColors';
import { useIsMobile } from '../../hooks/useIsMobile';
import PageHeader from '../../components/PageHeader';
import AlertBanner from '../../components/AlertBanner';
import EmptyState from '../../components/EmptyState';
import KpiCard from '../../components/KpiCard';
import { SkeletonCard, SkeletonChart } from '../../components/Skeleton';
import RecommendationsHandoff from '../../components/RecommendationsHandoff';

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

const DAY_MONTH_FMT      = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });
const FULL_DATE_FMT      = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const MONTH_YEAR_FMT     = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const MONTH_ONLY_FMT     = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const SHORT_DATE_FMT     = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const SHORT_MONTH_YEAR_FMT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

// Units for the raw local-SHAP `Feature Value` — most features are either a
// sales figure or a day-count within the period; unmapped (mostly calendar
// index) features render as a plain rounded number with no suffix.
const FEATURE_VALUE_UNITS = {
  PromoDays: 'promotion days', OpenDays: 'open days', SchoolHolidayDays: 'school holiday days',
  StateHolidayDays: 'state holiday days', WeekendDays: 'weekend days',
  MonthStartDays: 'days', MonthEndDays: 'days', periods_since_last_promo: 'periods',
  sales_lag_1: 'sales', sales_lag_2: 'sales', sales_lag_3: 'sales', sales_lag_4: 'sales',
  sales_lag_8: 'sales', sales_lag_12: 'sales', sales_lag_52: 'sales',
  rolling_mean_3: 'sales', rolling_mean_4: 'sales', rolling_mean_6: 'sales',
  rolling_mean_8: 'sales', rolling_mean_12: 'sales',
  EMA_3: 'sales', EMA_4: 'sales', EMA_6: 'sales', EMA_8: 'sales',
  CompetitionDistance: 'meters',
};

function toDate(period) {
  return new Date(`${period}T00:00:00`);
}

// ---- Pure formatting/derivation helpers — exported so tests can verify
// exact output without fighting Recharts' SVG rendering in JSDOM. ----

// Evenly-spaced index picker for the mobile chart's reduced tick set —
// always includes the first and last index, never exceeds `count`, and is a
// no-op (returns every index) when there are already fewer items than
// `count` (e.g. monthly's ≤3 points).
export function pickEvenIndices(length, count) {
  if (length <= count) return new Set(Array.from({ length }, (_, i) => i));
  const picks = new Set();
  for (let i = 0; i < count; i++) {
    picks.add(Math.round((i * (length - 1)) / (count - 1)));
  }
  return picks;
}

export function formatShortPeriod(period, forecastType) {
  return forecastType === 'weekly'
    ? SHORT_DATE_FMT.format(toDate(period))
    : SHORT_MONTH_YEAR_FMT.format(toDate(period));
}

export function formatFullDate(period) {
  return FULL_DATE_FMT.format(toDate(period));
}

export function formatWeeklyPeriod(period) {
  return `Week beginning ${formatFullDate(period)}`;
}

export function formatMonthlyPeriod(period) {
  return MONTH_YEAR_FMT.format(toDate(period));
}

export function formatSelectedPeriod(period, forecastType) {
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
// 1/2/4/5/6/8/10 x 10^n step — denser than the classic 1/2/5/10 set so a
// value like ~69K (headroom ~76K) rounds to a close-fitting 80K rather than
// overshooting all the way to 100K. Used for the "Start at zero" mode.
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

export function buildChartSummary(forecasts, effectivePeriod, forecastType) {
  if (!forecasts || forecasts.length === 0) return '';
  const idx = forecasts.findIndex(f => f.period === effectivePeriod);
  const current = idx >= 0 ? forecasts[idx] : forecasts[forecasts.length - 1];
  const previous = idx > 0 ? forecasts[idx - 1] : null;
  const maxPrediction = Math.max(...forecasts.map(f => f.prediction));
  const unit = forecastType === 'weekly' ? 'week' : 'month';

  let trendSentence;
  if (previous && previous.prediction) {
    const pct = ((current.prediction - previous.prediction) / Math.abs(previous.prediction)) * 100;
    const direction = pct >= 0 ? 'increased' : 'decreased';
    trendSentence = `Predicted sales ${direction} by ${Math.abs(pct).toFixed(1)}% from the previous ${unit}.`;
  } else {
    trendSentence = `This is the first ${unit} in the displayed evaluation period, so no previous-period change is available.`;
  }
  return `${trendSentence} The highest forecast in the displayed period is ${Math.round(maxPrediction).toLocaleString('en-US')}.`;
}

// Distinguishes "no previous period exists" (first period in the window)
// from "a previous period exists but its prediction was zero" (percentage
// change is undefined) — both used to collapse into the same "No previous
// period" text, which was inaccurate for the second case.
export function describePeriodChange(selectedRow, previousRow) {
  if (!previousRow) {
    return { state: 'no-previous', text: 'No previous period', sublabel: 'This is the first period in the displayed evaluation window.' };
  }
  if (!previousRow.prediction) {
    return { state: 'zero-previous', text: 'Not calculable', sublabel: "The previous period's prediction was zero, so a percentage change can't be calculated." };
  }
  const pct = ((selectedRow.prediction - previousRow.prediction) / Math.abs(previousRow.prediction)) * 100;
  return {
    state: 'ok',
    value: pct,
    direction: selectedRow.prediction >= previousRow.prediction ? 'up' : 'down',
    // Real minus sign (U+2212), matching formatShapContribution above —
    // Math.abs()+toFixed() avoids JS's ASCII hyphen for a negative number.
    text: `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`,
    sublabel: 'vs previous period',
  };
}

// Raw SHAP feature values are unrounded floats with no unit (e.g.
// `57399.4167`) — round and label them so a reader doesn't have to infer
// what the number means (`"57,399 sales"`, `"5 promotion days"`).
export function formatFeatureValue(feature, value) {
  const rounded = Math.round(value).toLocaleString('en-US');
  const unit = FEATURE_VALUE_UNITS[feature];
  return unit ? `${rounded} ${unit}` : rounded;
}

// Same treatment for the signed SHAP contribution itself, plus a real
// minus sign (U+2212) rather than a hyphen for the negative case. No unit
// suffix here — the panel states the unit once at the section level instead
// of repeating "predicted sales" after every row.
export function formatShapContribution(value) {
  const rounded = Math.round(Math.abs(value)).toLocaleString('en-US');
  return value >= 0 ? `+${rounded}` : `−${rounded}`;
}

// Defensive re-sort by absolute magnitude — the backend already returns
// /shap/local rows sorted this way, but this never assumes that contract.
export function topShapDrivers(rows, n = 3) {
  return [...(rows || [])].sort((a, b) => Math.abs(b['SHAP Value']) - Math.abs(a['SHAP Value'])).slice(0, n);
}

// ---- Presentational subcomponents ----

function DashboardChartTooltip({ active, payload, label, forecastType, showActual }) {
  if (!active || !payload?.length) return null;
  const predicted = payload.find(p => p.dataKey === 'Predicted')?.value;
  const actual    = showActual ? payload.find(p => p.dataKey === 'Actual')?.value : undefined;
  const periodLabel = forecastType === 'weekly' ? 'Week beginning' : 'Month';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700
                    shadow-lg px-4 py-3 text-xs min-w-[180px]">
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
        {showActual && actual != null && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-gray-500 dark:text-gray-400">Actual sales</span>
            <span className="font-semibold text-gray-800 dark:text-gray-100">{actual.toLocaleString('en-US')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// A Previous/Next stepper rather than a scrolling chip strip — avoids the
// horizontal scrollbar a 13-item strip forced, and is the primary
// keyboard-accessible way to change the selected period (the chart's SVG
// dots stay clickable too, as a mouse convenience, not the only path).
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

function LocalShapPanel({
  loading, error, rows, selectedStore, effectivePeriod, forecastType, onRetry, setActivePage, setHandoffPeriod,
}) {
  const cc = useChartColors();
  const topDrivers = topShapDrivers(rows, 3);
  const maxAbs = Math.max(...topDrivers.map(r => Math.abs(r['SHAP Value'])), 1);

  return (
    <div className="card">
      <h2 className="card-title mb-1">What influenced this prediction?</h2>
      <p className="text-secondary text-xs mb-4">
        Store {selectedStore} · {formatSelectedPeriod(effectivePeriod, forecastType)} · Contributions shown in
        predicted sales, relative to the model's baseline.
      </p>

      {loading && <SkeletonChart height={220} />}

      {!loading && error && <AlertBanner variant="error" onRetry={onRetry}>{error}</AlertBanner>}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="No local explanation available"
          message="This store and period combination doesn't have a saved SHAP explanation."
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="space-y-4">
            {topDrivers.map(row => {
              const value = row['SHAP Value'];
              const isPositive = value >= 0; // bar-side convention only — an exact-zero value has 0% width either way
              const pct = Math.min(100, (Math.abs(value) / maxAbs) * 100);
              const directionText = value > 0 ? 'Raises prediction' : value < 0 ? 'Lowers prediction' : 'No effect on this prediction';
              const toneClass = value > 0
                ? 'text-semantic-positive dark:text-indigo-400'
                : value < 0 ? 'text-semantic-negative dark:text-red-400' : 'text-gray-500 dark:text-gray-400';
              return (
                <div key={row.Feature} className="text-xs">
                  <p className="font-medium text-gray-700 dark:text-gray-300">
                    {getFeatureLabel(row.Feature, row['Readable Feature'])}
                  </p>
                  <p className={`font-semibold mt-0.5 ${toneClass}`}>
                    {formatShapContribution(value)} · {directionText}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <div className="flex-1 flex justify-end h-2.5">
                      {!isPositive && (
                        <div className="h-full rounded-l-full" style={{ width: `${pct}%`, backgroundColor: cc.chart.negative }} />
                      )}
                    </div>
                    <div className="w-px h-3 bg-gray-200 dark:bg-gray-600 flex-shrink-0" />
                    <div className="flex-1 h-2.5">
                      {isPositive && (
                        <div className="h-full rounded-r-full" style={{ width: `${pct}%`, backgroundColor: cc.chart.positive }} />
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                    Feature value: {formatFeatureValue(row.Feature, row['Feature Value'])}
                  </p>
                </div>
              );
            })}
          </div>

          <p className="text-secondary text-xs mt-4">
            Showing the 3 largest of {rows.length} modelled features. These are not the full calculation.
          </p>

          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
              How to read this
            </summary>
            <p className="text-secondary mt-1.5">
              SHAP shows how inputs contribute to raising or lowering a model prediction relative to its
              baseline. These contributions explain the prediction; they do not prove that changing an
              input will cause the same change in actual sales.
            </p>
          </details>

          {setActivePage && (
            <button
              type="button"
              onClick={() => { setHandoffPeriod?.(effectivePeriod); setActivePage('explanation'); }}
              className="mt-3 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded
                         min-h-[44px] px-1 -ml-1"
            >
              View full explanation →
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---- Main page ----

export default function Dashboard({ selectedStore, forecastType, setActivePage, setHandoffPeriod }) {
  const cc = useChartColors();
  const isMobile = useIsMobile();
  const [showActual, setShowActual] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [zeroBased, setZeroBased] = useState(false);

  const {
    data: forecastsData, loading: coreLoading, error: coreError, refetch: refetchCore,
  } = useApi(
    () => client.get(`/forecast/${selectedStore}?forecast_type=${forecastType}`).then(res => res.data.forecasts),
    [selectedStore, forecastType],
    'Failed to load dashboard data. Make sure the backend is running.'
  );

  const forecasts = useMemo(() => forecastsData || [], [forecastsData]);
  const latestPeriod = forecasts.length ? forecasts[forecasts.length - 1].period : null;
  const effectivePeriod = (selectedPeriod && forecasts.some(f => f.period === selectedPeriod))
    ? selectedPeriod
    : latestPeriod;

  const {
    data: shapPayload, loading: shapLoading, error: shapError, refetch: refetchShap,
  } = useApi(
    () => effectivePeriod
      ? client.get(`/shap/local?forecast_type=${forecastType}&store_id=${selectedStore}&period=${effectivePeriod}`)
          .then(res => res.data)
      : Promise.resolve(null),
    [selectedStore, forecastType, effectivePeriod],
    'Failed to load the local explanation for this period.'
  );
  const shapRows = shapPayload?.explanation || [];

  // Memoized on `forecasts` alone (which is reference-stable across
  // showActual/selectedPeriod/zeroBased changes — it only changes when a
  // fresh store/frequency fetch resolves) so yDomain below only recalculates
  // when the underlying data actually changes, not on every render.
  const chartData = useMemo(
    () => forecasts.map(f => ({ period: f.period, Predicted: Math.round(f.prediction), Actual: f.actual_sales })),
    [forecasts]
  );

  // Pools Predicted + Actual regardless of the showActual toggle, so the
  // axis never visibly shifts when that toggle is switched — only when
  // chartData or the zero-based mode itself changes.
  const yDomain = useMemo(() => {
    const values = seriesValues(chartData);
    return zeroBased ? niceDomain(values) : focusedDomain(values);
  }, [chartData, zeroBased]);

  if (coreLoading) return (
    <div className="animate-fadeIn">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
      <SkeletonChart height={320} />
    </div>
  );

  if (coreError) return <AlertBanner variant="error" onRetry={refetchCore}>{coreError}</AlertBanner>;

  if (forecasts.length === 0) return (
    <EmptyState
      title="No forecasts for this store"
      message="There are no precomputed predictions for the selected store and forecast type."
    />
  );

  const selectedRow = forecasts.find(f => f.period === effectivePeriod) || forecasts[forecasts.length - 1];
  const selectedIndex = forecasts.findIndex(f => f.period === selectedRow.period);
  const previousRow = selectedIndex > 0 ? forecasts[selectedIndex - 1] : null;
  const change = describePeriodChange(selectedRow, previousRow);

  // The shared `cc.chart.actual`/`cc.chart.predicted` tokens (reused as-is,
  // no new hex introduced) happen to hold an indigo and an orange value
  // respectively — the opposite pairing from what this chart needs (solid
  // indigo for Predicted, dashed blue-grey for Actual), so they're assigned
  // to series by their colour, not by their token name.
  const predictedColor = cc.chart.actual;
  const actualColor    = cc.axisLabel;

  // Mobile only: cap X-axis labels to ~4 evenly-spaced ticks (always including
  // the first and last) rather than skipping via Recharts' interval-count
  // prop, which doesn't guarantee an exact count or endpoint inclusion in
  // general. All chart points still plot — this only trims which ticks get
  // a text label. Desktop/tablet keep the default "show every tick" object.
  const mobileTickIndices = isMobile ? pickEvenIndices(forecasts.length, 4) : null;
  const xTickFormatter = forecastType === 'weekly'
    ? (period) => DAY_MONTH_FMT.format(toDate(period))
    : (period) => MONTH_ONLY_FMT.format(toDate(period));

  return (
    <div className="animate-fadeIn">
      <PageHeader
        icon={LayoutDashboard}
        title={`Store ${selectedStore} — ${forecastType === 'weekly' ? 'Weekly' : 'Monthly'} Dashboard`}
        subtitle="What's expected, why it's expected, and what to do about it."
        className="mb-4"
      />

      <p className="text-secondary text-sm mb-1">
        Historical test predictions · {formatDateRange(forecasts.map(f => f.period), forecastType)} · {forecasts.length} predictions
      </p>
      <details className="text-xs mb-4">
        <summary className="cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
          What does this mean?
        </summary>
        <p className="text-secondary mt-1.5">
          These are saved predictions from a held-out test period, evaluated against the store's
          actual historical sales — not a live forecast. The dashboard does not retrain the model.
        </p>
      </details>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-2">
        <KpiCard
          dense
          label="Forecasted sales"
          value={Math.round(selectedRow.prediction).toLocaleString('en-US')}
          icon={TrendingUp}
          tone="primary"
          sublabel={formatSelectedPeriod(selectedRow.period, forecastType)}
        />
        <KpiCard
          dense
          label="Change from previous period"
          value={change.text}
          icon={change.state === 'ok' ? (change.direction === 'down' ? ArrowDown : ArrowUp) : undefined}
          tone="neutral"
          sublabel={change.sublabel}
        />
      </div>
      {setActivePage && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          For model-level accuracy metrics, see{' '}
          <button
            type="button"
            onClick={() => setActivePage('compare')}
            className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
          >
            Model Comparison
          </button>.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 items-start">
        <div className="lg:col-span-2 card">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
            <div>
              <h2 className="card-title">
                {forecastType === 'weekly' ? 'Weekly' : 'Monthly'} Sales Forecast — Store {selectedStore}
              </h2>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showActual}
              onClick={() => setShowActual(s => !s)}
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
          </div>

          <div className="h-72 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 26 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
                <XAxis
                  dataKey="period"
                  interval={0}
                  tick={mobileTickIndices
                    ? (p) => !mobileTickIndices.has(p.index) ? null : (
                        <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize={11} fill={cc.axisTick}>
                          {xTickFormatter(p.payload.value)}
                        </text>
                      )
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
                <Tooltip content={<DashboardChartTooltip forecastType={forecastType} showActual={showActual} />} />
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
                  dot={(dotProps) => {
                    // Recharts can invoke this with an incomplete `payload`
                    // during transitional layout passes (e.g. before the
                    // ResponsiveContainer has measured a non-zero size) —
                    // guard rather than assume it's always populated.
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

          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
              View values
            </summary>
            <dl className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Period</dt>
                <dd className="font-medium text-gray-700 dark:text-gray-200">{formatSelectedPeriod(effectivePeriod, forecastType)}</dd>
              </div>
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Predicted sales</dt>
                <dd className="font-medium text-gray-700 dark:text-gray-200">{Math.round(selectedRow.prediction).toLocaleString('en-US')}</dd>
              </div>
              {showActual && (
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">Actual sales</dt>
                  <dd className="font-medium text-gray-700 dark:text-gray-200">
                    {selectedRow.actual_sales != null ? Math.round(selectedRow.actual_sales).toLocaleString('en-US') : 'Not available'}
                  </dd>
                </div>
              )}
            </dl>
          </details>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
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

          <p className="text-secondary text-xs mt-2">
            {buildChartSummary(forecasts, effectivePeriod, forecastType)}
          </p>

          {setActivePage && (
            <button
              type="button"
              onClick={() => { setHandoffPeriod?.(effectivePeriod); setActivePage('forecast'); }}
              className="mt-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded
                         min-h-[44px] px-1 -ml-1"
            >
              View full forecast →
            </button>
          )}
        </div>

        <LocalShapPanel
          loading={shapLoading}
          error={shapError}
          rows={shapRows}
          selectedStore={selectedStore}
          effectivePeriod={effectivePeriod}
          forecastType={forecastType}
          onRetry={refetchShap}
          setActivePage={setActivePage}
          setHandoffPeriod={setHandoffPeriod}
        />
      </div>

      <RecommendationsHandoff
        onOpen={setActivePage ? () => { setHandoffPeriod?.(effectivePeriod); setActivePage('agent'); } : undefined}
      />
    </div>
  );
}
