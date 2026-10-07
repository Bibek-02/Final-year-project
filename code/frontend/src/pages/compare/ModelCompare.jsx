import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import {
  Scale, Trophy, Lightbulb, AlertTriangle, TrendingUp, Search, Info,
} from 'lucide-react';
import client from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { useChartColors } from '../../hooks/useChartColors';
import PageHeader from '../../components/PageHeader';
import AlertBanner from '../../components/AlertBanner';
import { SkeletonCard, SkeletonChart, SkeletonTable } from '../../components/Skeleton';

const METRICS = ['MAE', 'RMSE', 'MAPE', 'RMSPE'];
const PERCENT_METRICS = new Set(['MAPE', 'RMSPE']);
const MOVING_AVERAGE_COLOR = '#94a3b8'; // slate-400 — reads fine on both light and dark

const FULL_DATE_FMT  = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const MONTH_YEAR_FMT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

const METRIC_MEANINGS = [
  { key: 'MAE',   title: 'MAE',   detail: 'Average absolute difference between predicted and actual sales, in sales units.' },
  { key: 'RMSE',  title: 'RMSE',  detail: 'Similar to MAE, but penalises larger errors more strongly.' },
  { key: 'MAPE',  title: 'MAPE',  detail: 'Average percentage error between predicted and actual sales.' },
  { key: 'RMSPE', title: 'RMSPE', detail: 'A percentage-error measure that gives more weight to larger percentage mistakes.' },
];

// ---- Formatting helpers — pure, local to this page (own copy per this
// codebase's established per-page convention; see Agent.jsx). ----

function toDate(period) {
  return new Date(`${period}T00:00:00`);
}

export function formatCount(n) {
  return n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');
}

export function formatPercent(n) {
  return n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(2)}%`;
}

export function formatMetricValue(metric, value) {
  return PERCENT_METRICS.has(metric) ? formatPercent(value) : formatCount(value);
}

export function formatDateRange(periods, forecastType) {
  if (!periods || periods.length === 0) return null;
  const sorted = [...periods].sort();
  const fmt = forecastType === 'weekly' ? FULL_DATE_FMT : MONTH_YEAR_FMT;
  const start = fmt.format(toDate(sorted[0]));
  const end = fmt.format(toDate(sorted[sorted.length - 1]));
  return start === end ? start : `${start} – ${end}`;
}

function getColor(model, cc) {
  if (model === 'Random Forest') return cc.chart.predicted;
  if (model === 'XGBoost') return cc.chart.actual;
  if (model?.startsWith('Moving Average')) return MOVING_AVERAGE_COLOR;
  return cc.chart.actual;
}

// Secondary bordered button — this codebase has no shared `.btn-secondary`
// class, so this mirrors the idiom used elsewhere (e.g. Agent.jsx) for
// secondary actions, kept local to this page per its established convention.
function ActionButton({ icon: Icon, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 text-sm font-semibold px-4 min-h-[44px]
                 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200
                 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors focus:outline-none
                 focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      <Icon size={15} aria-hidden="true" />
      {children}
    </button>
  );
}

// Weekly/Monthly as a radiogroup, mirroring StoreSelector's GranularityControl
// styling — but a page-local control with its own state, deliberately not
// wired to the app's global forecastType. This page is model-level evidence,
// not store/forecast-page navigation, so it keeps its own frequency choice.
function FrequencyToggle({ frequency, setFrequency }) {
  const OPTIONS = [
    { value: 'weekly',  label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Model evaluation frequency"
      className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600
                 bg-gray-50 dark:bg-gray-900 p-0.5"
    >
      {OPTIONS.map(opt => {
        const selected = frequency === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setFrequency(opt.value)}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors
                       focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
              selected
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// Compact evaluation-scope pills — establishes up front that this page is
// historical/held-out only, never live inference or runtime retraining/SHAP.
function ScopeStrip({ metadata, selectedModel }) {
  const pills = [
    'Historical held-out evaluation',
    `Runtime retraining: ${metadata?.architecture?.runtime_retraining ? 'Yes' : 'No'}`,
    'Runtime SHAP calculation: No',
    `Final model: ${selectedModel || 'XGBoost'}`,
    `Metrics: ${METRICS.join(', ')}`,
  ];
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {pills.map(p => (
        <span
          key={p}
          className="badge bg-gray-100 text-gray-600 border border-gray-200
                     dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 text-xs"
        >
          {p}
        </span>
      ))}
    </div>
  );
}

// Key/value summary row — CSS grid on desktop, stacked rows on mobile via
// the same grid collapsing to one column (same idiom as Agent.jsx's
// EvidenceRow, kept local per this codebase's per-page convention).
function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-gray-100
                    dark:border-gray-700/60 last:border-0">
      <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-sm font-semibold text-gray-800 dark:text-gray-100 text-right">{value}</dd>
    </div>
  );
}

export default function ModelCompare({ selectedStore = 1, setActivePage }) {
  const cc = useChartColors();
  const [frequency, setFrequency] = useState('weekly');
  const [activeMetric, setActiveMetric] = useState('MAPE');

  const { data, loading, error, refetch } = useApi(
    () => Promise.all([
      client.get('/models/compare?forecast_type=weekly'),
      client.get('/models/compare?forecast_type=monthly'),
      client.get('/models/best?forecast_type=weekly'),
      client.get('/models/best?forecast_type=monthly'),
      client.get('/metadata'),
      client.get(`/forecast/${selectedStore}?forecast_type=weekly`),
      client.get(`/forecast/${selectedStore}?forecast_type=monthly`),
    ]).then(([w, m, bw, bm, meta, fw, fm]) => ({
      weeklyData : w.data.comparison,
      monthlyData: m.data.comparison,
      bestWeekly : bw.data,
      bestMonthly: bm.data,
      metadata   : meta.data,
      // Held-out period count/date range come from a single store's forecast
      // artifact only as plumbing — every store shares the same held-out
      // period grid, so this is a global, model-level fact, not a
      // selected-store result (see the copy in SelectedModelSummary below).
      weeklyPeriods : fw.data.forecasts.map(f => f.period),
      monthlyPeriods: fm.data.forecasts.map(f => f.period),
    })),
    [selectedStore],
    'Failed to load model evaluation data.'
  );

  if (loading) return (
    <div className="animate-fadeIn space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
      <SkeletonCard />
      <SkeletonChart height={220} />
      <SkeletonTable rows={3} cols={5} />
    </div>
  );

  if (error) return <AlertBanner variant="error" onRetry={refetch}>{error}</AlertBanner>;

  const { weeklyData, monthlyData, bestWeekly, bestMonthly, metadata, weeklyPeriods, monthlyPeriods } = data;

  const isWeekly   = frequency === 'weekly';
  const chartData  = isWeekly ? weeklyData  : monthlyData;
  const best       = isWeekly ? bestWeekly  : bestMonthly;
  const periods    = isWeekly ? weeklyPeriods : monthlyPeriods;
  const meta       = metadata?.forecasting?.[frequency];

  return (
    <div className="animate-fadeIn">
      <PageHeader
        icon={Scale}
        title="Model Evaluation"
        subtitle="Comparing saved models on held-out Rossmann test data — no live forecasting or runtime retraining."
      />

      <ScopeStrip metadata={metadata} selectedModel={best?.best_model} />

      <div className="card mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <FrequencyToggle frequency={frequency} setFrequency={setFrequency} />
        </div>
        <p className="text-secondary text-xs mt-3">
          The store selected above does not change these results — model evaluation metrics are
          global, artifact-level results computed once across the held-out test set, not
          selected-store results.
        </p>
      </div>

      {/* Selected model summary */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Trophy size={16} className="text-indigo-600 dark:text-indigo-400" />
          <h2 className="card-title mb-0">Selected model — {isWeekly ? 'Weekly' : 'Monthly'}</h2>
        </div>
        <p className="text-secondary text-xs mb-4">
          Held-out test-set evidence for the {isWeekly ? 'weekly' : 'monthly'} forecasting model.
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8">
          <SummaryRow label="Selected model" value={best?.best_model || '—'} />
          <SummaryRow label="Test MAPE" value={formatPercent(best?.MAPE)} />
          <SummaryRow label="MAE" value={formatCount(best?.MAE)} />
          <SummaryRow label="Feature count" value={formatCount(meta?.feature_count)} />
          <SummaryRow label="Held-out period count" value={formatCount(periods?.length)} />
          <SummaryRow label="Held-out date range" value={formatDateRange(periods, frequency) || '—'} />
          <SummaryRow label="Selection basis" value={metadata?.model_selection?.primary_metric || '—'} />
          <SummaryRow label="Final evaluation" value={metadata?.model_selection?.test_set_use || '—'} />
        </dl>
      </div>

      {/* Metric comparison table */}
      <div className="card mb-6">
        <h2 className="card-title mb-1">{isWeekly ? 'Weekly' : 'Monthly'} results — all metrics</h2>
        <p className="text-secondary text-xs mb-3">Lower values are better for all metrics.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left rounded-l-xl">Model</th>
                {METRICS.map(m => (
                  <th key={m} className="px-4 py-3 text-left">{m}</th>
                ))}
                <th className="px-4 py-3 text-left rounded-r-xl">Rank</th>
              </tr>
            </thead>
            <tbody>
              {[...chartData].sort((a, b) => a.RMSE - b.RMSE).map((row, i) => {
                const isSelected = row.Model === best?.best_model;
                return (
                  <tr key={i} className={`table-row ${isSelected ? 'bg-indigo-50/40 dark:bg-indigo-500/10' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ background: getColor(row.Model, cc) }} />
                        <span className={`text-xs ${isSelected ? 'font-bold text-gray-800 dark:text-gray-100' : 'font-medium text-gray-700 dark:text-gray-300'}`}>
                          {row.Model}
                        </span>
                      </div>
                    </td>
                    {METRICS.map(m => (
                      <td key={m} className={`px-4 py-3 text-xs tabular-nums ${
                        isSelected
                          ? 'font-bold text-indigo-600 dark:text-indigo-400'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}>
                        {formatMetricValue(m, row[m])}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      {isSelected
                        ? (
                          <span className="badge bg-indigo-100 text-indigo-700 gap-1 dark:bg-indigo-500/10 dark:text-indigo-400">
                            <Trophy size={12} /> Selected for DSS
                          </span>
                        )
                        : <span className="text-gray-400 dark:text-gray-500 text-xs">#{i + 1}</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compact bar chart */}
      <div className="card mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h2 className="card-title mb-0">{isWeekly ? 'Weekly' : 'Monthly'} — {activeMetric} comparison</h2>
          <div className="flex flex-wrap gap-2">
            {METRICS.map(m => (
              <button
                key={m}
                onClick={() => setActiveMetric(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold
                            transition-all duration-150 ${
                  activeMetric === m
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <p className="text-secondary text-xs mb-3">Lower bars are better.</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
            <XAxis dataKey="Model" tick={{ fontSize: 10, fill: cc.axisLabel }} interval={0}
                   tickFormatter={m => m.replace('Moving Average ', 'MA ')}
                   label={{ value: 'Model', position: 'bottom', offset: 0, fontSize: 11, fill: cc.axisLabel }} />
            <YAxis
              tick={{ fontSize: 11, fill: cc.axisTick }}
              tickFormatter={v => PERCENT_METRICS.has(activeMetric) ? `${v}%` : v.toLocaleString('en-US')}
              label={{
                value: PERCENT_METRICS.has(activeMetric) ? `${activeMetric} (%)` : `${activeMetric} (sales units)`,
                angle: -90, position: 'insideLeft', fontSize: 11, fill: cc.axisLabel,
                style: { textAnchor: 'middle' },
              }}
            />
            <Tooltip
              formatter={(value) => [formatMetricValue(activeMetric, value), activeMetric]}
              contentStyle={{ borderRadius: '12px', border: `1px solid ${cc.tooltip.border}`,
                              background: cc.tooltip.background, color: cc.tooltip.text,
                              fontSize: '13px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
            />
            <Bar dataKey={activeMetric} radius={[6, 6, 0, 0]} isAnimationActive={false}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={getColor(entry.Model, cc)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Why XGBoost was selected */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Lightbulb size={16} className="text-indigo-600 dark:text-indigo-400" />
          <h2 className="card-title mb-0">Why XGBoost was selected</h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-3">
          XGBoost was selected because it achieved the strongest held-out performance compared
          with the baseline models and supports SHAP-based explanations. This makes it suitable
          for the DSS because the artefact needs both forecasting performance and explainable
          prediction drivers.
        </p>
        <ul className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
          <li className="flex items-start gap-2">
            <span className="text-gray-400 mt-1">•</span>
            Better test-set performance than Moving Average and Random Forest in the saved
            evaluation artifacts (see the table above).
          </li>
          <li className="flex items-start gap-2">
            <span className="text-gray-400 mt-1">•</span>
            Handles engineered lag, rolling, promotion, holiday and store-related features
            ({formatCount(metadata?.forecasting?.weekly?.feature_count)} weekly /
            {' '}{formatCount(metadata?.forecasting?.monthly?.feature_count)} monthly features).
          </li>
          <li className="flex items-start gap-2">
            <span className="text-gray-400 mt-1">•</span>
            Compatible with SHAP explanations
            {metadata?.explainability?.length ? `: ${metadata.explainability.join(', ')}.` : '.'}
          </li>
          <li className="flex items-start gap-2">
            <span className="text-gray-400 mt-1">•</span>
            Fits the artifact-first backend design — forecasts and SHAP values are precomputed,
            not generated at request time.
          </li>
        </ul>
      </div>

      {/* What these metrics mean */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Info size={16} className="text-indigo-600 dark:text-indigo-400" />
          <h2 className="card-title mb-0">What these metrics mean</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {METRIC_MEANINGS.map(({ key, title, detail }) => (
            <div key={key} className="bg-gray-50 dark:bg-gray-900/50 border border-gray-100
                                      dark:border-gray-700 rounded-xl p-3">
              <p className="text-xs font-bold text-gray-800 dark:text-gray-100 mb-1">{title}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Evaluation scope and limitations */}
      <div className="card mb-6">
        <h3 className="card-title flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" /> Evaluation scope and limitations
        </h3>
        <ul className="mt-2 space-y-1.5">
          {[
            'Historical held-out Rossmann data only.',
            'No live future forecasting in this deployed artefact.',
            'No backend retraining.',
            'No runtime SHAP calculation.',
            `Monthly evaluation uses ${formatCount(monthlyPeriods?.length)} held-out periods, fewer than the ${formatCount(weeklyPeriods?.length)} used for weekly, so interpretation should be cautious.`,
            'Actual sales are used for retrospective evaluation only, not as AI recommendation input.',
            'Results are specific to the Rossmann dataset and this evaluation window.',
          ].map((l, i) => (
            <li key={i} className="text-sm text-gray-600 dark:text-gray-300 flex items-start gap-2">
              <span className="text-gray-400 mt-1">•</span>{l}
            </li>
          ))}
        </ul>
      </div>

      {setActivePage && (
        <div className="flex flex-wrap gap-2 mb-6">
          <ActionButton icon={TrendingUp} onClick={() => setActivePage('forecast')}>View Forecast Analysis</ActionButton>
          <ActionButton icon={Search} onClick={() => setActivePage('explanation')}>View Forecast Explanation</ActionButton>
        </div>
      )}
    </div>
  );
}
