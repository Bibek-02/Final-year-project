import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  LayoutDashboard, TrendingUp, ArrowUp, ArrowDown, Target, CalendarDays,
  Lightbulb, Boxes, Users2, Megaphone, ChevronLeft, ChevronRight,
} from 'lucide-react';
import client from '../../api/client';
import { readableLabel } from '../../lib/featureLabels';
import { useApi } from '../../hooks/useApi';
import { useChartColors } from '../../hooks/useChartColors';
import { useIsMobile } from '../../hooks/useIsMobile';
import PageHeader from '../../components/PageHeader';
import AlertBanner from '../../components/AlertBanner';
import EmptyState from '../../components/EmptyState';
import KpiCard from '../../components/KpiCard';
import { SkeletonCard, SkeletonChart } from '../../components/Skeleton';

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

const DAY_MONTH_FMT      = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });
const FULL_DATE_FMT      = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const MONTH_YEAR_FMT     = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const MONTH_ONLY_FMT     = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const SHORT_DATE_FMT     = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const SHORT_MONTH_YEAR_FMT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

const HISTORICAL_CONTEXT = {
  weekly : 'Includes recent sales patterns and sales from the same week last year.',
  monthly: 'Includes recent sales patterns and sales from the same month last year.',
};

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
const LEARN_MORE_DETAIL = {
  weekly : 'Sales lag features: 1, 2, 4, 8 and 52 weeks. Rolling mean and standard deviation windows: 4, 8 and 12 weeks. EMA windows: 4 and 8 weeks.',
  monthly: 'Sales lag features: 1, 2, 3 and 12 months. Rolling mean and standard deviation windows: 3 and 6 months. EMA windows: 3 and 6 months.',
};
const URGENCY_BADGE = {
  high  : 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
  medium: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  low   : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};
const CHIP_ICONS = { Inventory: Boxes, Staffing: Users2, Promotion: Megaphone };

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
// overshooting all the way to 100K.
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

function capitalize(s) {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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
// minus sign (U+2212) rather than a hyphen for the negative case.
export function formatShapContribution(value) {
  const rounded = Math.round(Math.abs(value)).toLocaleString('en-US');
  return value >= 0 ? `+${rounded} predicted sales` : `−${rounded} predicted sales`;
}

export function buildLocalShapSummary(rows) {
  if (!rows || rows.length === 0) return '';
  const positive = [...rows].filter(r => r['SHAP Value'] > 0).sort((a, b) => b['SHAP Value'] - a['SHAP Value'])[0];
  const negative = [...rows].filter(r => r['SHAP Value'] < 0).sort((a, b) => a['SHAP Value'] - b['SHAP Value'])[0];
  const posLabel = positive ? readableLabel(positive.Feature).toLowerCase() : null;
  const negLabel = negative ? readableLabel(negative.Feature).toLowerCase() : null;

  if (posLabel && negLabel) return `${capitalize(posLabel)} increased this prediction, while ${negLabel} reduced it.`;
  if (posLabel) return `${capitalize(posLabel)} was the leading factor increasing this prediction.`;
  if (negLabel) return `${capitalize(negLabel)} was the leading factor reducing this prediction.`;
  return '';
}

// ---- Presentational subcomponents ----

function UnderstandingCard({ forecastType, forecasts }) {
  const count = forecasts.length;
  const range = formatDateRange(forecasts.map(f => f.period), forecastType);
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-700/60 bg-gray-50/60
                    dark:bg-gray-800/40 px-5 py-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Understanding this forecast</h3>
        <div className="flex gap-2">
          <span className="badge bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
            Precomputed results
          </span>
          <span className="badge bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
            No runtime retraining
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Available predictions</dt>
          <dd className="font-medium text-gray-700 dark:text-gray-200 mt-0.5">
            {count} {forecastType} predictions
          </dd>
        </div>
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Evaluation period</dt>
          <dd className="font-medium text-gray-700 dark:text-gray-200 mt-0.5">{range}</dd>
        </div>
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Historical context</dt>
          <dd className="font-medium text-gray-700 dark:text-gray-200 mt-0.5">{HISTORICAL_CONTEXT[forecastType]}</dd>
        </div>
      </dl>
      <p className="text-secondary text-xs mt-3">
        These are precomputed predictions from the held-out test dataset. The dashboard does not retrain the model.
      </p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
          Learn more
        </summary>
        <p className="text-secondary mt-1.5">{LEARN_MORE_DETAIL[forecastType]}</p>
      </details>
    </div>
  );
}

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

function LocalShapPanel({ loading, error, rows, selectedStore, effectivePeriod, forecastType, onRetry }) {
  const cc = useChartColors();
  const top5 = rows.slice(0, 5);
  const maxAbs = Math.max(...top5.map(r => Math.abs(r['SHAP Value'])), 1);

  return (
    <div className="card">
      <h2 className="card-title mb-1">Why this forecast?</h2>
      <p className="text-secondary text-xs mb-4">
        Store {selectedStore} · {formatSelectedPeriod(effectivePeriod, forecastType)}
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
          <div className="space-y-3">
            {top5.map(row => {
              const value = row['SHAP Value'];
              const isPositive = value >= 0;
              const pct = Math.min(100, (Math.abs(value) / maxAbs) * 100);
              return (
                <div key={row.Feature}>
                  <div className="flex items-center justify-between text-xs mb-1 gap-2">
                    <span className="font-medium text-gray-700 dark:text-gray-300 truncate">
                      {readableLabel(row.Feature)}
                    </span>
                    <span className="text-secondary flex-shrink-0">
                      {formatShapContribution(value)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
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
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    Feature value: {formatFeatureValue(row.Feature, row['Feature Value'])}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-secondary text-xs mt-4">{buildLocalShapSummary(top5)}</p>
        </>
      )}
    </div>
  );
}

function RetrospectiveEvaluation({ row }) {
  const actual = row.actual_sales;
  const predicted = row.prediction;
  const hasActual = actual != null;

  return (
    <div className="card mb-6">
      <h3 className="card-title mb-1">Historical evaluation</h3>
      {!hasActual ? (
        <p className="text-secondary text-xs">Actual sales are not available for this period.</p>
      ) : (
        <>
          <p className="text-secondary text-xs mb-4">
            Actual sales are shown because this is a historical held-out test-period prediction, not a live forecast.
          </p>
          {(() => {
            const error = predicted - actual;
            const absError = Math.abs(error);
            const ape = actual !== 0 ? (absError / Math.abs(actual)) * 100 : null;
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard label="Actual sales" value={Math.round(actual).toLocaleString('en-US')} tone="neutral" />
                <KpiCard
                  label="Forecast error"
                  value={`${error >= 0 ? '+' : ''}${Math.round(error).toLocaleString('en-US')}`}
                  tone={error >= 0 ? 'warning' : 'primary'}
                />
                <KpiCard label="Absolute error" value={Math.round(absError).toLocaleString('en-US')} tone="neutral" />
                <KpiCard
                  label="Absolute % error"
                  value={ape != null ? `${ape.toFixed(1)}%` : 'N/A — zero actual sales'}
                  tone="neutral"
                />
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

function RecommendationCard({ selectedStore, forecastType, effectivePeriod, evidenceReady }) {
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (state === 'loading' || !evidenceReady) return;
    setState('loading');
    setError('');
    try {
      const res = await client.post(
        `/agent/recommend?store_id=${selectedStore}&forecast_type=${forecastType}&period=${effectivePeriod}`
      );
      setResult(res.data);
      setState('done');
    } catch (err) {
      setError(err.response?.data?.detail || 'Recommendation generation failed. Please try again.');
      setState('error');
    }
  };

  return (
    <div className="card mb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl flex items-center
                          justify-center flex-shrink-0">
            <Lightbulb size={18} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="min-w-0">
            <h3 className="card-title">Recommended next step</h3>
            <p className="text-secondary text-xs mt-0.5 max-w-lg">
              Generate evidence-based stock, staffing and promotion guidance using the selected forecast
              and its local SHAP explanation.
            </p>
            <div className="flex gap-2 mt-2 flex-wrap">
              {['Inventory', 'Staffing', 'Promotion'].map(label => {
                const Icon = CHIP_ICONS[label];
                return (
                  <span key={label} className="badge bg-gray-100 text-gray-600 dark:bg-gray-700
                                               dark:text-gray-300 flex items-center gap-1">
                    <Icon size={12} /> {label}
                  </span>
                );
              })}
            </div>
            <p className="text-secondary text-xs mt-2">
              Uses Store {selectedStore} · {evidenceReady ? formatSelectedPeriod(effectivePeriod, forecastType) : 'waiting for forecast data…'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={!evidenceReady || state === 'loading'}
          className="btn-primary w-full md:w-auto flex-shrink-0 flex items-center justify-center gap-2
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state === 'loading' ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating…
            </>
          ) : 'Generate recommendations'}
        </button>
      </div>

      {state === 'error' && (
        <div className="mt-4">
          <AlertBanner variant="error" onRetry={handleGenerate}>{error}</AlertBanner>
        </div>
      )}

      {state === 'done' && result && (
        <div className="rounded-xl bg-indigo-50 dark:bg-indigo-500/10 p-4 mt-4">
          <p className="text-sm text-gray-700 dark:text-gray-200 mb-2">{result.recommendations.summary}</p>
          <div className="flex gap-2 flex-wrap">
            {['staffing', 'stock', 'promotions'].map(key => (
              <span key={key} className={`badge ${URGENCY_BADGE[result.recommendations[key].urgency]}`}>
                {key}: {result.recommendations[key].urgency}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Main page ----

export default function Dashboard({ selectedStore, forecastType }) {
  const cc = useChartColors();
  const isMobile = useIsMobile();
  const [showActual, setShowActual] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState(null);

  const {
    data: coreData, loading: coreLoading, error: coreError, refetch: refetchCore,
  } = useApi(
    () => Promise.all([
      client.get(`/forecast/${selectedStore}?forecast_type=${forecastType}`),
      client.get('/metadata'),
    ]).then(([forecastRes, metaRes]) => ({
      forecasts: forecastRes.data.forecasts,
      metadata : metaRes.data,
    })),
    [selectedStore, forecastType],
    'Failed to load dashboard data. Make sure the backend is running.'
  );

  const forecasts = coreData?.forecasts || [];
  const metadata  = coreData?.metadata || null;
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

  const chartData = forecasts.map(f => ({
    period: f.period,
    Predicted: Math.round(f.prediction),
    Actual: f.actual_sales,
  }));

  const yDomain = useMemo(() => {
    const values = chartData.flatMap(d => showActual ? [d.Predicted, d.Actual] : [d.Predicted]);
    return niceDomain(values);
  }, [chartData, showActual]); // eslint-disable-line react-hooks/exhaustive-deps

  if (coreLoading) return (
    <div className="animate-fadeIn">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
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
  const changeTrend = previousRow && previousRow.prediction
    ? {
        value: ((selectedRow.prediction - previousRow.prediction) / Math.abs(previousRow.prediction)) * 100,
        direction: selectedRow.prediction >= previousRow.prediction ? 'up' : 'down',
      }
    : null;

  const testMetrics = metadata?.forecasting?.[forecastType]?.test_metrics;
  const evidenceReady = !shapLoading && !shapError && shapRows.length > 0;

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
      />

      <UnderstandingCard forecastType={forecastType} forecasts={forecasts} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Forecasted sales"
          value={Math.round(selectedRow.prediction).toLocaleString('en-US')}
          icon={TrendingUp}
          tone="success"
        />
        <KpiCard
          label="Change from previous period"
          value={changeTrend ? `${changeTrend.value >= 0 ? '+' : ''}${changeTrend.value.toFixed(1)}%` : 'No previous period'}
          icon={changeTrend?.direction === 'down' ? ArrowDown : ArrowUp}
          tone={!changeTrend ? 'neutral' : changeTrend.direction === 'up' ? 'success' : 'danger'}
          sublabel={changeTrend ? 'vs previous period' : 'No previous period in this evaluation window'}
        />
        <KpiCard
          label="Selected period"
          value={formatShortPeriod(selectedRow.period, forecastType)}
          icon={CalendarDays}
          tone="primary"
          compact
          sublabel={forecastType === 'weekly' ? 'Week beginning' : undefined}
        />
        <KpiCard
          label="Test MAPE"
          value={testMetrics ? `${testMetrics.MAPE.toFixed(1)}%` : 'Unavailable'}
          icon={Target}
          tone="neutral"
          sublabel="Held-out test period"
          tooltip="Average absolute percentage error on the held-out test period, across all stores — lower is better."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 card">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
            <div>
              <h2 className="card-title">
                {forecastType === 'weekly' ? 'Weekly' : 'Monthly'} Sales Forecast — Store {selectedStore}
              </h2>
              <p className="text-secondary text-xs mt-0.5">
                {forecasts.length} historical test predictions · {formatDateRange(forecasts.map(f => f.period), forecastType)}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showActual}
              onClick={() => setShowActual(s => !s)}
              className={`flex items-center gap-2 px-3 rounded-xl text-xs font-semibold min-h-[44px]
                         transition-colors flex-shrink-0 ${
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
          </div>

          <div className="h-72 mt-4">
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
                <Area type="linear" dataKey="Predicted" stroke="none" fill={predictedColor}
                      fillOpacity={0.08} isAnimationActive={false} />
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

          <PeriodNavigator
            forecasts={forecasts}
            effectivePeriod={effectivePeriod}
            forecastType={forecastType}
            onSelect={setSelectedPeriod}
          />

          <p className="text-secondary text-xs mt-3">
            {buildChartSummary(forecasts, effectivePeriod, forecastType)}
          </p>
        </div>

        <LocalShapPanel
          loading={shapLoading}
          error={shapError}
          rows={shapRows}
          selectedStore={selectedStore}
          effectivePeriod={effectivePeriod}
          forecastType={forecastType}
          onRetry={refetchShap}
        />
      </div>

      {showActual && <RetrospectiveEvaluation row={selectedRow} />}

      <RecommendationCard
        selectedStore={selectedStore}
        forecastType={forecastType}
        effectivePeriod={effectivePeriod}
        evidenceReady={evidenceReady}
      />
    </div>
  );
}
