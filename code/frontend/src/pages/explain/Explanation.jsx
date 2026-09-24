import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import {
  Search, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Download, AlertTriangle, Lightbulb,
} from 'lucide-react';
import client from '../../api/client';
import { getFeatureLabel } from '../../lib/featureLabels';
import { useApi } from '../../hooks/useApi';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useChartColors } from '../../hooks/useChartColors';
import PageHeader from '../../components/PageHeader';
import AlertBanner from '../../components/AlertBanner';
import EmptyState from '../../components/EmptyState';
import { SkeletonChart } from '../../components/Skeleton';
import RecommendationsHandoff from '../../components/RecommendationsHandoff';

// ---- Constants ----

const NEUTRAL = '#9ca3af'; // gray-400, the app's structural/neutral chrome color
const MINUS = '−';         // real minus sign (U+2212), not the ASCII hyphen Number.toFixed produces

const TOP_N_GLOBAL     = 10; // global chart/list: "approximately the top 10 global features"
const TOP_N_WATERFALL  = 6;  // local waterfall: named individual contributors before folding the rest
const TOP_N_TABLE      = 10; // technical table: rows shown before "Show all features"
const RECONCILE_TOLERANCE = 1; // sales units — see the reconciliation-check note below

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

const FULL_DATE_FMT        = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const MONTH_YEAR_FMT       = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const SHORT_DATE_FMT       = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const SHORT_MONTH_YEAR_FMT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

// Units for the raw local-SHAP "Feature Value" — mirrors Dashboard.jsx's own
// FEATURE_VALUE_UNITS (duplicated per this codebase's established per-page
// convention rather than shared, same as its PeriodNavigator/formatters).
const FEATURE_VALUE_UNITS = {
  PromoDays: 'promotion days', OpenDays: 'open days', SchoolHolidayDays: 'school holiday days',
  StateHolidayDays: 'state holiday days', WeekendDays: 'weekend days',
  MonthStartDays: 'days', MonthEndDays: 'days', periods_since_last_promo: 'periods',
  sales_lag_1: 'sales', sales_lag_2: 'sales', sales_lag_3: 'sales', sales_lag_4: 'sales',
  sales_lag_8: 'sales', sales_lag_12: 'sales', sales_lag_52: 'sales',
  rolling_mean_3: 'sales', rolling_mean_4: 'sales', rolling_mean_6: 'sales',
  rolling_mean_8: 'sales', rolling_mean_12: 'sales',
  rolling_std_3: 'sales', rolling_std_4: 'sales', rolling_std_6: 'sales',
  rolling_std_8: 'sales', rolling_std_12: 'sales',
  EMA_3: 'sales', EMA_4: 'sales', EMA_6: 'sales', EMA_8: 'sales',
  CompetitionDistance: 'meters',
};

function isBinaryFeature(feature) {
  return feature === 'Promo2' || feature === 'CompetitionOpenKnown'
    || feature.startsWith('StoreType_') || feature.startsWith('Assortment_') || feature.startsWith('PromoInterval_');
}

function toDate(period) {
  return new Date(`${period}T00:00:00`);
}

// ---- Pure formatting/derivation helpers — exported so tests can verify
// exact output without fighting Recharts' SVG rendering in JSDOM. ----

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

// All FEATURE_VALUE_UNITS entries are plural nouns ("days", "periods",
// "sales", "meters") — drop the trailing "s" for an exact count of 1 so a
// single-day feature reads "1 day", not "1 days". Every other count (0, 2, 5, ...) is unaffected.
function pluralizeUnit(unit, count) {
  return count === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit;
}

// Raw SHAP feature values are unrounded floats with no unit — round and
// label them so a reader doesn't have to infer what the number means
// ("57,399 sales", "5 promotion days"), and render 0/1 dummy/flag columns
// as Yes/No rather than a bare digit.
export function formatFeatureValue(feature, value) {
  if (isBinaryFeature(feature)) return value >= 0.5 ? 'Yes' : 'No';
  const roundedNum = Math.round(value);
  const rounded = roundedNum.toLocaleString('en-US');
  const unit = FEATURE_VALUE_UNITS[feature];
  return unit ? `${rounded} ${pluralizeUnit(unit, roundedNum)}` : rounded;
}

export function formatRounded(value) {
  return Math.round(value).toLocaleString('en-US');
}

export function formatSignedRounded(value) {
  const rounded = Math.round(Math.abs(value)).toLocaleString('en-US');
  return value >= 0 ? `+${rounded}` : `${MINUS}${rounded}`;
}

// Full-precision figures (e.g. the technical table's tooltip) still need the
// real minus sign, not the ASCII hyphen JS's own number-to-string uses.
export function formatFullPrecision(value) {
  return value < 0 ? `${MINUS}${Math.abs(value)}` : `${value}`;
}

// Same treatment as Dashboard.jsx's formatShapContribution, plus an explicit
// "no effect" case for the rare exact-zero SHAP row.
export function formatShapContribution(value) {
  if (value === 0) return 'No effect on predicted sales';
  const rounded = Math.round(Math.abs(value)).toLocaleString('en-US');
  return value > 0 ? `+${rounded} predicted sales` : `${MINUS}${rounded} predicted sales`;
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function lowerFirst(s) {
  return s && s.length ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// ---- Global SHAP: normalization + deterministic summary ----

export function normalizeGlobalRows(rawRows) {
  return [...(rawRows || [])]
    .map(r => ({
      rawFeature: r.Feature,
      label: getFeatureLabel(r.Feature, r['Readable Feature']),
      meanShap: r.Mean_SHAP,
    }))
    .sort((a, b) => b.meanShap - a.meanShap);
}

// Built purely from the sorted rows passed in — no hardcoded feature names —
// so it stays correct if the ranking ever changes.
export function buildGlobalShapSummary(sortedRows, forecastType) {
  if (!sortedRows || sortedRows.length === 0) return '';
  const unit = forecastType === 'weekly' ? 'weekly' : 'monthly';
  const [first, second, third] = sortedRows;
  // first.label is already the computed display label (see normalizeGlobalRows) — just capitalize it as the sentence's lead.
  const leadCapitalized = first.label.charAt(0).toUpperCase() + first.label.slice(1);
  if (!second) return `${leadCapitalized} has the largest average influence on ${unit} predictions.`;
  if (!third) {
    return `${leadCapitalized} has the largest average influence on ${unit} predictions, `
      + `followed by ${lowerFirst(second.label)}.`;
  }
  return `${leadCapitalized} has the largest average influence on ${unit} predictions, `
    + `followed by ${lowerFirst(second.label)} and ${lowerFirst(third.label)}.`;
}

// ---- Local SHAP: normalization, drivers, waterfall ----

// Builds ONE normalized local-explanation object from the paired /shap/local
// and /forecast/{store} responses. Every downstream consumer (summary box,
// waterfall/cards, technical table, technical metadata) reads from this one
// object or a memoized slice of it — never re-derives numbers independently.
// This is what makes a waterfall/table mismatch structurally impossible.
export function buildLocalExplanation({ localData, forecasts, selectedStore, forecastType }) {
  if (!localData) return null;
  if (localData.notFound) return { notFound: true, reason: localData.reason };

  const rows = localData.explanation || [];
  const matchedForecast = (forecasts || []).find(f => f.period === localData.period);
  const contributions = rows.map(r => ({
    rawFeature  : r.Feature,
    label       : getFeatureLabel(r.Feature, r['Readable Feature']),
    featureValue: r['Feature Value'],
    shapValue   : r['SHAP Value'],
    effect      : r.Effect,
  }));
  const sumShap = contributions.reduce((s, c) => s + c.shapValue, 0);
  const predictedSales = matchedForecast ? matchedForecast.prediction : null;
  const baseline = predictedSales != null ? predictedSales - sumShap : null;

  // Reconciliation is algebraically guaranteed in the happy path (baseline is
  // DERIVED as predictedSales - sumShap — there is no independent SHAP
  // expected_value in the artifacts to check against). It's still checked,
  // because it also verifies matchedForecast was actually found by period
  // (the one way this can genuinely fail) and guards against a stale-memo
  // bug pairing one period's forecast with another period's SHAP rows.
  const reconciliationOk = !!matchedForecast
    && contributions.length > 0
    && Number.isFinite(baseline)
    && Math.abs(baseline + sumShap - predictedSales) < RECONCILE_TOLERANCE;

  return {
    notFound: false,
    store: selectedStore,
    period: localData.period,
    forecastType,
    totalFeatureCount: localData.record_count,
    predictedSales,
    baseline,
    sumShap,
    contributions,
    reconciliationOk,
  };
}

export function getTopDrivers(contributions) {
  const increase = [...contributions].filter(c => c.shapValue > 0).sort((a, b) => b.shapValue - a.shapValue)[0] || null;
  const decrease = [...contributions].filter(c => c.shapValue < 0).sort((a, b) => a.shapValue - b.shapValue)[0] || null;
  return { increase, decrease };
}

export function buildLocalShapSummary(contributions) {
  const { increase, decrease } = getTopDrivers(contributions);
  const cap = s => (s.charAt(0).toUpperCase() + s.slice(1));
  if (increase && decrease) {
    return `${cap(increase.label)} increased this prediction, while ${decrease.label.toLowerCase()} had the largest decreasing effect.`;
  }
  if (increase) return `${cap(increase.label)} was the leading factor increasing this prediction.`;
  if (decrease) return `${cap(decrease.label)} was the leading factor reducing this prediction.`;
  return '';
}

// Deterministic plain-language synthesis of the selected forecast, built
// only from the one normalized localExplanation object — never a second
// fetch, never actual sales, never a hardcoded store/feature name. Uses only
// pre-approved non-causal phrasing ("increased/reduced the prediction",
// "partly offset the increase") so it never implies the model proved
// real-world causation.
export function buildBusinessInterpretation(localExplanation) {
  if (!localExplanation) return '';
  const { forecastType, predictedSales, sumShap, contributions } = localExplanation;
  if (!contributions || contributions.length === 0 || predictedSales == null || !Number.isFinite(sumShap)) return '';

  const typeLabel = forecastType === 'weekly' ? 'weekly' : 'monthly';
  const predictedStr = formatRounded(predictedSales);
  const magnitude = formatRounded(Math.abs(sumShap));
  const cap = s => (s.charAt(0).toUpperCase() + s.slice(1));

  // Both arrays inherit the API's own |SHAP| descending sort, so [0]/[1] are
  // already each group's largest-magnitude members — no extra re-sort needed.
  const positives = contributions.filter(c => c.shapValue > 0);
  const negatives = contributions.filter(c => c.shapValue < 0);
  const joinTop2 = list => (list[1] ? `${lowerFirst(list[0].label)} and ${lowerFirst(list[1].label)}` : lowerFirst(list[0].label));

  if (Math.abs(sumShap) < RECONCILE_TOLERANCE) {
    return `The ${typeLabel} forecast of ${predictedStr} is close to the model's baseline output, `
      + `as increasing and decreasing feature contributions largely offset each other.`;
  }

  const lead = `The ${typeLabel} forecast of ${predictedStr} is ${magnitude} `
    + `${sumShap < 0 ? 'below' : 'above'} the model's baseline output.`;

  if (sumShap < 0) {
    const negPart = negatives.length > 0 ? `Negative model contributions from ${joinTop2(negatives)}` : 'Decreasing feature contributions';
    const posClause = positives.length > 0 ? ` more than ${lowerFirst(positives[0].label)} increased it` : '';
    return `${lead} ${negPart} reduced the prediction${posClause}.`;
  }

  const posPart = positives.length > 0 ? cap(joinTop2(positives)) : 'Increasing feature contributions';
  const negClause = negatives.length > 0 ? `, while ${lowerFirst(negatives[0].label)} partly offset the increase` : '';
  return `${lead} ${posPart} increased the prediction${negClause}.`;
}

// Base -> prediction bridge: baseline, up to TOP_N_WATERFALL named
// contributors (already sorted by |SHAP| by the API), one dynamic
// "Other N features (net)" step (N computed from the actual contribution
// count, never hardcoded), then the final predicted-sales step.
export function buildWaterfall(localExplanation) {
  const { baseline, contributions, predictedSales } = localExplanation;
  const top  = contributions.slice(0, TOP_N_WATERFALL);
  const rest = contributions.slice(TOP_N_WATERFALL);
  const otherSum = rest.reduce((s, c) => s + c.shapValue, 0);

  let cumulative = baseline;
  const rows = [{ name: 'Baseline model output', low: 0, high: baseline, display: baseline, isTotal: true }];

  top.forEach(c => {
    const start = cumulative;
    cumulative += c.shapValue;
    rows.push({
      name: c.label, rawFeature: c.rawFeature,
      low: Math.min(start, cumulative), high: Math.max(start, cumulative),
      display: c.shapValue, positive: c.shapValue >= 0,
    });
  });

  if (rest.length > 0) {
    const start = cumulative;
    cumulative += otherSum;
    rows.push({
      name: `Other ${rest.length} features (net)`,
      low: Math.min(start, cumulative), high: Math.max(start, cumulative),
      display: otherSum, positive: otherSum >= 0, isOther: true,
    });
  }

  rows.push({ name: 'Predicted sales', low: 0, high: cumulative, display: predictedSales != null ? predictedSales : cumulative, isTotal: true });

  return rows.map(r => ({ ...r, base: r.low, range: r.high - r.low }));
}

// CSV export (technical details) 
// csvEscape/downloadCsv, duplicated per this codebase's convention. 

function csvEscape(value) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
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

function buildTechnicalCsv(localExplanation) {
  const headers = ['Feature', 'Raw feature', 'Observed value', 'SHAP contribution', 'Direction'];
  const lines = [headers.join(',')];
  localExplanation.contributions.forEach(c => {
    lines.push([
      csvEscape(c.label), csvEscape(c.rawFeature), c.featureValue, c.shapValue, csvEscape(c.effect),
    ].join(','));
  });
  return lines.join('\n');
}

// ---- About SHAP card ----

function AboutShapCard() {
  const concepts = [
    { title: 'Overall model', tone: 'default',
      text: 'Shows which features generally have the greatest influence across the sampled held-out observations.' },
    { title: 'Selected forecast', tone: 'default',
      text: 'Shows how individual feature contributions moved one prediction away from the model’s baseline output.' },
    { title: 'Important limitation', tone: 'warning',
      text: 'SHAP describes model behaviour. It does not prove that a feature caused real-world sales to change.' },
  ];

  return (
    <div className="card mb-6">
      <h2 className="card-title mb-1">Understanding SHAP explanations</h2>
      <p className="text-secondary text-xs mb-3">
        SHAP estimates how features influence model predictions at two levels: overall model
        behaviour and one selected forecast.
      </p>

      <dl className="hidden sm:grid sm:grid-cols-3 gap-4 text-xs">
        {concepts.map(c => (
          <div key={c.title}>
            <dt className={`font-semibold mb-1 ${c.tone === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-gray-200'}`}>
              {c.title}
            </dt>
            <dd className="text-secondary">{c.text}</dd>
          </div>
        ))}
      </dl>

      <details className="sm:hidden mt-1 text-xs">
        <summary className="cursor-pointer font-semibold text-indigo-600 dark:text-indigo-400
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
          How to understand SHAP
        </summary>
        <dl className="mt-2 space-y-2">
          {concepts.map(c => (
            <div key={c.title}>
              <dt className={`font-semibold ${c.tone === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-gray-200'}`}>
                {c.title}
              </dt>
              <dd className="text-secondary">{c.text}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

// ---- Tabs ----

const TABS = [
  { id: 'overall', label: 'Overall model' },
  { id: 'selected', label: 'Selected forecast' },
];

function ExplanationTabs({ activeTab, onChange }) {
  const refs = useRef({});

  const focusAndSelect = (id) => {
    onChange(id);
    refs.current[id]?.focus();
  };

  const handleKeyDown = (e) => {
    const idx = TABS.findIndex(t => t.id === activeTab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusAndSelect(TABS[(idx + 1) % TABS.length].id);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusAndSelect(TABS[(idx - 1 + TABS.length) % TABS.length].id);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAndSelect(TABS[0].id);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAndSelect(TABS[TABS.length - 1].id);
    }
  };

  return (
    <div
      role="tablist"
      aria-label="SHAP explanation scope"
      onKeyDown={handleKeyDown}
      className="flex w-full sm:w-auto sm:max-w-md rounded-lg border border-gray-200
                 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-0.5 mb-6"
    >
      {TABS.map(tab => {
        const selected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            ref={el => { refs.current[tab.id] = el; }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`flex-1 sm:flex-none px-2 sm:px-4 py-2 min-h-[44px] rounded-md text-sm font-semibold
                       text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
                       focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900 ${
              selected
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Global panel ----

function GlobalTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700
                    shadow-lg px-4 py-3 text-xs max-w-[240px]">
      <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">{row.label}</p>
      <p className="text-gray-600 dark:text-gray-300">
        Average absolute effect: <span className="font-semibold">{formatRounded(row.meanShap)} predicted sales</span>
      </p>
      <p className="text-secondary mt-1.5">
        This measures average influence size. It does not show direction for an individual forecast.
      </p>
    </div>
  );
}

function GlobalShapChart({ rows, cc, isMobile }) {
  const labelColWidth = isMobile ? 92 : 185;
  const chartMarginL  = isMobile ? 96 : 190;
  const labelMaxChars = isMobile ? 13 : 40;

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: chartMarginL, bottom: 28 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: cc.axisTick }}
          tickFormatter={v => compactNumber.format(v)}
          label={{ value: 'Average absolute effect on predicted sales', position: 'insideBottom', offset: -12, fill: cc.axisLabel, fontSize: 11 }}
        />
        <YAxis
          type="category" dataKey="label"
          tickFormatter={l => truncate(l, labelMaxChars)}
          tick={{ fontSize: 11, fill: cc.axisLabel }} width={labelColWidth}
        />
        <Tooltip content={<GlobalTooltip />} />
        <Bar dataKey="meanShap" radius={[0, 6, 6, 0]} isAnimationActive={false}>
          {rows.map((_, i) => (
            <Cell key={i} fill={i < 3 ? cc.chart.positive : cc.chart.positive + 'b3'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function GlobalRankedTable({ rows }) {
  const maxVal = rows.length ? rows[0].meanShap : 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="table-header">
            <th scope="col" className="px-4 py-2 text-left rounded-l-xl">Rank</th>
            <th scope="col" className="px-4 py-2 text-left">Feature</th>
            <th scope="col" className="px-4 py-2 text-right rounded-r-xl">Mean |SHAP|</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.rawFeature} className="table-row">
              <td className="px-4 py-2 text-gray-500 dark:text-gray-400 text-xs">{i + 1}</td>
              <td className="px-4 py-2 font-medium text-gray-700 dark:text-gray-200 text-xs">
                <div>{row.label}</div>
                <div className="h-1.5 mt-1 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.max(4, (row.meanShap / maxVal) * 100)}%` }} />
                </div>
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300 text-xs">
                {formatRounded(row.meanShap)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GlobalPanel({ hidden, loading, error, rows, forecastType, cc, isMobile, onRetry }) {
  const scopeLabel = forecastType === 'weekly' ? 'Weekly' : 'Monthly';

  return (
    <div id="panel-overall" role="tabpanel" aria-labelledby="tab-overall" hidden={hidden}>
      <div className="card mb-6">
        <h2 className="card-title mb-2">What influences the {forecastType} model overall?</h2>

        <div className="flex flex-wrap gap-2 mb-3">
          <span className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400">{scopeLabel}</span>
          <span className="badge bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">Model-level explanation</span>
          <span className="badge bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">1,000 sampled test observations</span>
          <span className="badge bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">Precomputed SHAP</span>
        </div>

        <p className="text-secondary text-xs mb-1">
          Mean absolute SHAP values show the average size of each feature's influence across a reproducible
          sample of 1,000 held-out test observations (random_state = 42). They do not show whether the
          feature usually increases or decreases predictions.
        </p>
        <p className="text-secondary text-xs mb-5">Store selection applies to the Selected forecast tab.</p>

        {loading && <SkeletonChart height={360} />}
        {!loading && error && <AlertBanner variant="error" onRetry={onRetry}>{error}</AlertBanner>}
        {!loading && !error && rows.length === 0 && (
          <EmptyState
            title="No global explanation available"
            message="The precomputed global SHAP artifact for this forecast type could not be found."
          />
        )}

        {!loading && !error && rows.length > 0 && (
          <>
            <div className="hidden md:block">
              <GlobalShapChart rows={rows} cc={cc} isMobile={isMobile} />
              <details className="mt-4 text-xs">
                <summary className="cursor-pointer font-semibold text-indigo-600 dark:text-indigo-400
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
                  View as list
                </summary>
                <div className="mt-3"><GlobalRankedTable rows={rows} /></div>
              </details>
            </div>
            <div className="md:hidden">
              <GlobalRankedTable rows={rows} />
            </div>
            <p className="text-secondary text-xs mt-4">{buildGlobalShapSummary(rows, forecastType)}</p>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Local panel ----

// Previous/Next stepper, same interaction pattern as Dashboard.jsx's
// PeriodNavigator (duplicated per this codebase's per-page convention).
function LocalPeriodNavigator({ forecasts, effectivePeriod, forecastType, onSelect }) {
  const index = forecasts.findIndex(f => f.period === effectivePeriod);
  const atFirst = index <= 0;
  const atLast = index === -1 || index >= forecasts.length - 1;
  const navButtonClass = 'flex items-center gap-1 min-h-[44px] px-2 sm:px-3 rounded-lg text-xs font-semibold '
    + 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors '
    + 'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent '
    + 'focus:outline-none focus:ring-2 focus:ring-indigo-400 flex-shrink-0';

  // flex-wrap is a safety net, not the expected case: at the narrowest
  // phone widths (360-375px) the three items are tight against the card's
  // available width, so this lets the row fold onto two centered lines
  // rather than force a horizontal scrollbar.
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 sm:gap-x-3 mt-3" role="group" aria-label="Step through local explanation periods">
      <button
        type="button"
        onClick={() => !atFirst && onSelect(forecasts[index - 1].period)}
        disabled={atFirst} aria-label="Previous period" className={navButtonClass}
      >
        <ChevronLeft size={14} /> Previous
      </button>
      <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 min-w-[6.5rem] text-center flex-shrink-0">
        {formatShortPeriod(effectivePeriod, forecastType)}
      </span>
      <button
        type="button"
        onClick={() => !atLast && onSelect(forecasts[index + 1].period)}
        disabled={atLast} aria-label="Next period" className={navButtonClass}
      >
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
}

function LocalContextLine({ localExplanation }) {
  return (
    <p className="text-secondary text-xs mb-4">
      Store {localExplanation.store} · {formatSelectedPeriod(localExplanation.period, localExplanation.forecastType)} · Predicted sales:{' '}
      <span className="font-semibold text-gray-700 dark:text-gray-200">{formatRounded(localExplanation.predictedSales)}</span>
    </p>
  );
}

function LocalSummaryBox({ localExplanation }) {
  const { baseline, sumShap, predictedSales, contributions } = localExplanation;
  const { increase, decrease } = getTopDrivers(contributions);

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-700/60 bg-gray-50/60
                    dark:bg-gray-800/40 px-5 py-4 mb-5">
      <div className="grid grid-cols-3 gap-3 text-center mb-4">
        <div>
          <dt className="text-[11px] text-gray-500 dark:text-gray-400">Baseline model output</dt>
          <dd className="text-sm font-bold text-gray-700 dark:text-gray-200 mt-0.5 tabular-nums">{formatRounded(baseline)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-gray-500 dark:text-gray-400">Net feature adjustment</dt>
          <dd className={`text-sm font-bold mt-0.5 tabular-nums ${
            sumShap >= 0 ? 'text-semantic-positive dark:text-indigo-400' : 'text-semantic-negative dark:text-red-400'
          }`}>
            {formatSignedRounded(sumShap)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-gray-500 dark:text-gray-400">Predicted sales</dt>
          <dd className="text-sm font-bold text-gray-700 dark:text-gray-200 mt-0.5 tabular-nums">{formatRounded(predictedSales)}</dd>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <span className="font-semibold text-gray-700 dark:text-gray-200">Largest increase: </span>
          {increase
            ? <span className="text-secondary">{increase.label}, {formatShapContribution(increase.shapValue)}</span>
            : <span className="text-secondary">No feature increased this prediction.</span>}
        </div>
        <div>
          <span className="font-semibold text-gray-700 dark:text-gray-200">Largest decrease: </span>
          {decrease
            ? <span className="text-secondary">{decrease.label}, {formatShapContribution(decrease.shapValue)}</span>
            : <span className="text-secondary">No feature decreased this prediction.</span>}
        </div>
      </div>

      <p className="text-secondary text-xs mt-3">{buildLocalShapSummary(contributions)}</p>
    </div>
  );
}

function WaterfallLegend({ cc }) {
  return (
    <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 mt-3 flex-wrap">
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm inline-block flex-shrink-0" style={{ backgroundColor: cc.chart.positive }} />
        Increases prediction
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm inline-block flex-shrink-0" style={{ backgroundColor: cc.chart.negative }} />
        Decreases prediction
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm inline-block flex-shrink-0" style={{ backgroundColor: NEUTRAL }} />
        Baseline / final output
      </span>
    </div>
  );
}

function WaterfallLabel({ x, y, width, height, index, rows, color }) {
  const row = rows[index];
  if (!row) return null;
  const text = row.isTotal ? formatRounded(row.display) : formatSignedRounded(row.display);
  return (
    <text x={x + width + 8} y={y + height / 2} dy={4} fontSize={11} fill={color} fontWeight={600}>
      {text}
    </text>
  );
}

// Custom Recharts bar shape so individual bars can be real, keyboard
// -focusable, clickable targets (Cell alone doesn't reliably receive DOM
// event handlers across Recharts versions).
function WaterfallBarShape({ x, y, width, height, payload, cc, highlightedFeature, onHighlight }) {
  const fill = payload.isTotal ? NEUTRAL : payload.positive ? cc.chart.positive : cc.chart.negative;
  const clickable = !payload.isTotal && !payload.isOther;
  const isHighlighted = clickable && payload.rawFeature === highlightedFeature;
  const dimmed = clickable && highlightedFeature && !isHighlighted;
  const label = payload.isTotal
    ? `${payload.name}: ${formatRounded(payload.display)}`
    : `${payload.name}: ${formatSignedRounded(payload.display)} predicted sales`;

  return (
    <rect
      x={x} y={y} width={Math.max(width, 0)} height={height} rx={4}
      fill={fill}
      opacity={dimmed ? 0.5 : 1}
      className={clickable ? 'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400' : undefined}
      style={clickable ? { cursor: 'pointer' } : undefined}
      tabIndex={clickable ? 0 : -1}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? label : undefined}
      onClick={clickable ? () => onHighlight(payload.rawFeature) : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHighlight(payload.rawFeature); }
      } : undefined}
    />
  );
}

function LocalWaterfallChart({ waterfallRows, cc, isMobile, highlightedFeature, onHighlight }) {
  const labelColWidth = isMobile ? 92 : 190;
  const chartMarginL  = isMobile ? 96 : 195;
  const labelMaxChars = isMobile ? 13 : 40;

  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(280, waterfallRows.length * 40)}>
        <BarChart data={waterfallRows} layout="vertical" margin={{ top: 4, right: 64, left: chartMarginL, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} horizontal={false} />
          <XAxis type="number" domain={[0, 'dataMax']} tick={{ fontSize: 11, fill: cc.axisTick }}
                 tickFormatter={v => formatRounded(v)} />
          <YAxis type="category" dataKey="name" tickFormatter={n => truncate(n, labelMaxChars)}
                 tick={{ fontSize: 11, fill: cc.axisLabel }} width={labelColWidth} />
          <Tooltip
            formatter={(v, n, p) => {
              const row = p.payload;
              const text = row.isTotal ? formatRounded(row.display) : `${formatSignedRounded(row.display)} predicted sales`;
              return [text, row.isTotal ? 'Value' : 'Contribution'];
            }}
            labelFormatter={l => l}
            contentStyle={{ borderRadius: '12px', border: `1px solid ${cc.tooltip.border}`,
                            background: cc.tooltip.background, color: cc.tooltip.text,
                            fontSize: '13px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
          />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar
            dataKey="range" stackId="w" isAnimationActive={false}
            shape={(props) => (
              <WaterfallBarShape {...props} cc={cc} highlightedFeature={highlightedFeature} onHighlight={onHighlight} />
            )}
          >
            <LabelList content={<WaterfallLabel rows={waterfallRows} color={cc.axisLabel} />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <WaterfallLegend cc={cc} />
      <p className="text-secondary text-xs mt-2">
        Bars show each feature's modelled contribution to this prediction, not proof that the feature caused sales to change.
      </p>
    </>
  );
}

function LocalStackedCards({ waterfallRows, highlightedFeature, onHighlight }) {
  const maxAbs = Math.max(...waterfallRows.filter(r => !r.isTotal).map(r => Math.abs(r.display)), 1);

  return (
    <div className="space-y-2">
      {waterfallRows.map((row, i) => {
        const clickable = !row.isTotal && !row.isOther;
        const isHighlighted = clickable && row.rawFeature === highlightedFeature;
        const valueClass = row.isTotal
          ? 'text-gray-600 dark:text-gray-300'
          : row.positive ? 'text-semantic-positive dark:text-indigo-400' : 'text-semantic-negative dark:text-red-400';

        const inner = (
          <>
            <div className="flex items-center justify-between gap-3">
              {/* min-w-0 is required alongside truncate on a flex child —
                  without it, a flex item's implicit min-width:auto stops it
                  shrinking below its content's natural size, so long labels
                  ("Recent 12-week sales variability") would push the row
                  wider than the card instead of actually truncating. */}
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate min-w-0">{row.name}</span>
              <span className={`text-xs font-semibold tabular-nums flex-shrink-0 ${valueClass}`}>
                {row.isTotal ? formatRounded(row.display) : formatSignedRounded(row.display)}
              </span>
            </div>
            {!row.isTotal && (
              <div className="h-1.5 mt-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div className={`h-full rounded-full ${row.positive ? 'bg-indigo-500' : 'bg-red-400'}`}
                     style={{ width: `${Math.min(100, (Math.abs(row.display) / maxAbs) * 100)}%` }} />
              </div>
            )}
          </>
        );

        return clickable ? (
          <button
            key={i} type="button" onClick={() => onHighlight(row.rawFeature)}
            className={`w-full text-left rounded-xl px-3 py-2.5 min-h-[44px] border transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              isHighlighted ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-500/40 dark:bg-indigo-500/10'
                             : 'border-gray-100 dark:border-gray-700/60 bg-white dark:bg-gray-800/40'
            }`}
          >
            {inner}
          </button>
        ) : (
          <div
            key={i}
            className={`rounded-xl px-3 py-2.5 border ${
              row.isOther ? 'border-gray-100 dark:border-gray-700/60 bg-white dark:bg-gray-800/40'
                          : 'border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700/60'
            }`}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function DirectionInfo(effect) {
  if (effect === 'Increases prediction') return { Icon: TrendingUp, text: 'Increases' };
  if (effect === 'Decreases prediction') return { Icon: TrendingDown, text: 'Decreases' };
  return { Icon: Minus, text: 'No effect' };
}

function TechnicalRow({ contribution, isHighlighted, onSelect }) {
  const { Icon, text } = DirectionInfo(contribution.effect);
  const dirClass = contribution.shapValue > 0
    ? 'bg-indigo-50 text-semantic-positive dark:bg-indigo-500/10 dark:text-indigo-400'
    : contribution.shapValue < 0
      ? 'bg-red-50 text-semantic-negative dark:bg-red-500/10 dark:text-red-400'
      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';

  return (
    <tr
      className={`table-row cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset
                 focus-visible:ring-indigo-400 ${isHighlighted ? 'bg-indigo-50 dark:bg-indigo-500/10' : ''}`}
      tabIndex={0}
      aria-selected={isHighlighted}
      onClick={() => onSelect(contribution.rawFeature)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(contribution.rawFeature); } }}
    >
      <td className="px-4 py-2.5 font-medium text-gray-700 dark:text-gray-300 text-xs">{contribution.label}</td>
      <td className="px-4 py-2.5 text-right text-gray-500 dark:text-gray-400 text-xs tabular-nums">
        {formatFeatureValue(contribution.rawFeature, contribution.featureValue)}
      </td>
      <td className="px-4 py-2.5 text-right text-xs tabular-nums">
        <span
          className={contribution.shapValue >= 0 ? 'font-bold text-semantic-positive dark:text-indigo-400' : 'font-bold text-semantic-negative dark:text-red-400'}
          title={`Full precision: ${formatFullPrecision(contribution.shapValue)}`}
        >
          {formatSignedRounded(contribution.shapValue)}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs">
        <span className={`badge text-xs gap-1 ${dirClass}`}><Icon size={12} /> {text}</span>
      </td>
    </tr>
  );
}

function TechnicalCard({ contribution, isHighlighted, onSelect }) {
  const { text } = DirectionInfo(contribution.effect);
  return (
    <button
      type="button" onClick={() => onSelect(contribution.rawFeature)}
      className={`w-full text-left rounded-xl px-3 py-2.5 min-h-[44px] border transition-colors
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
        isHighlighted ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-500/40 dark:bg-indigo-500/10'
                       : 'border-gray-100 dark:border-gray-700/60 bg-white dark:bg-gray-800/40'
      }`}
    >
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{contribution.label}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
        Observed: {formatFeatureValue(contribution.rawFeature, contribution.featureValue)}
      </p>
      <div className="flex items-center justify-between mt-1">
        <span className={`text-xs font-bold tabular-nums ${
          contribution.shapValue >= 0 ? 'text-semantic-positive dark:text-indigo-400' : 'text-semantic-negative dark:text-red-400'
        }`}>
          {formatSignedRounded(contribution.shapValue)} predicted sales
        </span>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">{text}</span>
      </div>
    </button>
  );
}

function TechnicalDetailsTable({ contributions, totalFeatureCount, showAll, onToggleShowAll, highlightedFeature, onHighlight }) {
  const visible = showAll ? contributions : contributions.slice(0, TOP_N_TABLE);

  return (
    <div>
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="table-header">
              <th scope="col" className="px-4 py-2 text-left rounded-l-xl">Feature</th>
              <th scope="col" className="px-4 py-2 text-right">Observed value</th>
              <th scope="col" className="px-4 py-2 text-right">Effect on predicted sales</th>
              <th scope="col" className="px-4 py-2 text-left rounded-r-xl">Direction</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(c => (
              <TechnicalRow key={c.rawFeature} contribution={c}
                            isHighlighted={c.rawFeature === highlightedFeature} onSelect={onHighlight} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="sm:hidden space-y-2">
        {visible.map(c => (
          <TechnicalCard key={c.rawFeature} contribution={c}
                         isHighlighted={c.rawFeature === highlightedFeature} onSelect={onHighlight} />
        ))}
      </div>

      {contributions.length > TOP_N_TABLE && (
        <button
          type="button" onClick={onToggleShowAll}
          className="mt-3 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded min-h-[44px] px-1"
        >
          {showAll ? 'Show fewer features' : `Show all features (${totalFeatureCount})`}
        </button>
      )}
    </div>
  );
}

function TechnicalMetadata({ localExplanation }) {
  const { store, period, forecastType, baseline, sumShap, predictedSales, totalFeatureCount } = localExplanation;
  const rows = [
    ['Selected store', `Store ${store}`],
    ['Selected period', formatSelectedPeriod(period, forecastType)],
    ['Forecast type', forecastType === 'weekly' ? 'Weekly' : 'Monthly'],
    ['Selected model', 'XGBoost'],
    ['Baseline model output', formatRounded(baseline)],
    ['Sum of SHAP contributions', formatSignedRounded(sumShap)],
    ['Predicted sales', formatRounded(predictedSales)],
    ['Feature count', String(totalFeatureCount)],
    ['Local artifact source', 'Precomputed local SHAP explanation'],
    ['Explanation type', 'Local SHAP'],
    ['Runtime SHAP calculation', 'No'],
    ['Runtime model retraining', 'No'],
  ];

  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs mt-5 pt-5 border-t border-gray-100 dark:border-gray-700/60">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
          <dd className="font-medium text-gray-700 dark:text-gray-200 mt-0.5 tabular-nums">{value}</dd>
        </div>
      ))}
      <div className="col-span-2 sm:col-span-3">
        <dt className="text-gray-500 dark:text-gray-400">Baseline model output + all SHAP contributions = predicted sales</dt>
        <dd className="font-medium text-gray-700 dark:text-gray-200 mt-0.5 font-mono text-[11px] tabular-nums">
          {formatRounded(baseline)} + ({formatSignedRounded(sumShap)}) = {formatRounded(predictedSales)}
        </dd>
      </div>
    </dl>
  );
}

function ReconciliationFailure({ onRetry }) {
  return (
    <div
      role="alert" aria-live="polite"
      className="border rounded-2xl p-4 text-sm flex items-center gap-2
                bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400"
    >
      <AlertTriangle size={16} className="flex-shrink-0" />
      <span className="flex-1">
        Explanation unavailable — the numbers for this period could not be verified against the forecast,
        so they are not being shown to avoid displaying inconsistent figures.
      </span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-semibold underline underline-offset-2 hover:no-underline flex-shrink-0">
          Retry
        </button>
      )}
    </div>
  );
}

// Plain-language synthesis of the selected forecast — a deterministic
// interpretation of the SHAP evidence already on screen, not an AI-generated
// recommendation (those stay on the separate AI Recommendations page).
function BusinessInterpretation({ localExplanation }) {
  const text = buildBusinessInterpretation(localExplanation);
  if (!text) return null;

  return (
    <div className="mt-5 bg-indigo-50 border border-indigo-100 rounded-xl p-5
                    dark:bg-indigo-500/15 dark:border-indigo-500/40">
      <div className="flex items-center gap-2 mb-2">
        <Lightbulb size={16} className="text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
        <h3 className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">Business interpretation</h3>
      </div>
      <p className="text-indigo-900 dark:text-indigo-100 text-sm leading-relaxed">{text}</p>
      <p className="text-indigo-700/70 dark:text-indigo-300/70 text-[11px] mt-2 italic">
        This is a model interpretation of the forecast, not a business recommendation.
      </p>
    </div>
  );
}

function LocalPanel({
  hidden,
  forecastsLoading, forecastsError, onRetryForecasts,
  localLoading, localError, onRetryLocal,
  forecasts, effectivePeriod, forecastType, onPeriodSelect,
  localExplanation,
  showAllFeatures, onToggleShowAll,
  highlightedFeature, onHighlight,
  cc, isMobile, setActivePage, setHandoffPeriod,
}) {
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const anyLoading = forecastsLoading || localLoading;
  const anyError = forecastsError || localError;
  const retryAll = () => { onRetryForecasts(); onRetryLocal(); };

  return (
    <div id="panel-selected" role="tabpanel" aria-labelledby="tab-selected" hidden={hidden}>
      <div className="card mb-6">
        <h2 className="card-title mb-1">Why this specific forecast?</h2>

        {!anyLoading && !anyError && forecasts.length > 0 && (
          <LocalPeriodNavigator
            forecasts={forecasts} effectivePeriod={effectivePeriod}
            forecastType={forecastType} onSelect={onPeriodSelect}
          />
        )}

        <div className="mt-4">
          {anyLoading && <SkeletonChart height={280} />}

          {!anyLoading && anyError && (
            <AlertBanner variant="error" onRetry={retryAll}>{forecastsError || localError}</AlertBanner>
          )}

          {!anyLoading && !anyError && forecasts.length === 0 && (
            <EmptyState
              title="No forecasts for this store"
              message="There are no precomputed predictions for the selected store and forecast type."
            />
          )}

          {!anyLoading && !anyError && forecasts.length > 0 && localExplanation?.notFound && (
            <EmptyState
              title={localExplanation.reason === 'period' ? 'No local explanation for this period' : 'No local explanation for this store'}
              message="This store and period combination doesn't have a saved SHAP explanation."
            />
          )}

          {!anyLoading && !anyError && localExplanation && !localExplanation.notFound && !localExplanation.reconciliationOk && (
            <ReconciliationFailure onRetry={retryAll} />
          )}

          {!anyLoading && !anyError && localExplanation && !localExplanation.notFound && localExplanation.reconciliationOk && (
            <>
              <LocalContextLine localExplanation={localExplanation} />
              <LocalSummaryBox localExplanation={localExplanation} />

              <div className="hidden md:block">
                <LocalWaterfallChart
                  waterfallRows={buildWaterfall(localExplanation)}
                  cc={cc} isMobile={isMobile}
                  highlightedFeature={highlightedFeature} onHighlight={onHighlight}
                />
              </div>
              <div className="md:hidden">
                <LocalStackedCards
                  waterfallRows={buildWaterfall(localExplanation)}
                  highlightedFeature={highlightedFeature} onHighlight={onHighlight}
                />
              </div>

              <BusinessInterpretation localExplanation={localExplanation} />

              {/* Driven explicitly via React state rather than relying on the
                  browser's default <summary> click activation, so the open
                  state and the "Show/Hide" label always agree. */}
              <details className="mt-5" open={technicalOpen}>
                <summary
                  onClick={(e) => { e.preventDefault(); setTechnicalOpen(o => !o); }}
                  className="cursor-pointer flex items-center gap-1.5 text-xs font-semibold text-indigo-600
                             hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                >
                  {technicalOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {technicalOpen ? 'Hide technical details' : 'Show technical details'}
                </summary>

                <div className="mt-4 animate-fadeIn">
                  <div className="flex justify-end mb-2">
                    <button
                      type="button"
                      onClick={() => downloadCsv(
                        buildTechnicalCsv(localExplanation),
                        `shap_local_store${localExplanation.store}_${localExplanation.period}.csv`
                      )}
                      className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400
                                 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
                                 rounded min-h-[44px] px-2"
                    >
                      <Download size={14} aria-hidden="true" /> Download technical details (CSV)
                    </button>
                  </div>

                  <TechnicalDetailsTable
                    contributions={localExplanation.contributions}
                    totalFeatureCount={localExplanation.totalFeatureCount}
                    showAll={showAllFeatures} onToggleShowAll={onToggleShowAll}
                    highlightedFeature={highlightedFeature} onHighlight={onHighlight}
                  />

                  <TechnicalMetadata localExplanation={localExplanation} />
                </div>
              </details>
            </>
          )}
        </div>
      </div>

      {!anyLoading && !anyError && localExplanation && !localExplanation.notFound && localExplanation.reconciliationOk && (
        <RecommendationsHandoff
          onOpen={setActivePage ? () => { setHandoffPeriod?.(effectivePeriod); setActivePage('agent'); } : undefined}
        />
      )}
    </div>
  );
}

// ---- Main page ----

export default function Explanation({ selectedStore, forecastType, setActivePage, handoffPeriod, setHandoffPeriod }) {
  const cc = useChartColors();
  const isMobile = useIsMobile();

  // A period handed off from another page (e.g. Dashboard's "View full
  // explanation") seeds both which period is selected and which tab opens —
  // a handoff implies "show me that period's explanation" — then is
  // consumed once and cleared so a later direct visit doesn't reuse it.
  const [activeTab, setActiveTab] = useState(() => (handoffPeriod ? 'selected' : 'overall'));
  const [selectedPeriod, setSelectedPeriod] = useState(() => handoffPeriod || null);
  useEffect(() => {
    if (handoffPeriod) setHandoffPeriod?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const [highlightedFeature, setHighlightedFeature] = useState(null);

  const handleHighlight = (rawFeature) => {
    setHighlightedFeature(prev => (prev === rawFeature ? null : rawFeature));
  };

  // Global SHAP: keyed only on forecastType — never refetches when only the
  // store changes, since global SHAP is not store-specific.
  const {
    data: globalData, loading: globalLoading, error: globalError, refetch: refetchGlobal,
  } = useApi(
    () => client.get(`/shap/global?forecast_type=${forecastType}&top_n=${TOP_N_GLOBAL}`).then(res => res.data.features),
    [forecastType],
    'Failed to load global SHAP data.'
  );
  const globalRows = useMemo(() => normalizeGlobalRows(globalData), [globalData]);

  // Forecast list: drives the local period navigator and supplies the
  // matched prediction used to derive the local baseline.
  const {
    data: forecastData, loading: forecastsLoading, error: forecastsError, refetch: refetchForecasts,
  } = useApi(
    () => client.get(`/forecast/${selectedStore}?forecast_type=${forecastType}`).then(res => res.data.forecasts),
    [selectedStore, forecastType],
    'Failed to load forecast periods.'
  );
  const forecasts = useMemo(() => forecastData || [], [forecastData]);
  const latestPeriod = forecasts.length ? forecasts[forecasts.length - 1].period : null;
  const effectivePeriod = (selectedPeriod && forecasts.some(f => f.period === selectedPeriod))
    ? selectedPeriod
    : latestPeriod;

  // Local SHAP: kept as its own call (not combined with the forecast list)
  // since it depends on effectivePeriod and must refetch on every
  // Previous/Next click without re-fetching the whole forecast list.
  const {
    data: localData, loading: localLoading, error: localError, refetch: refetchLocal,
  } = useApi(
    () => effectivePeriod
      ? client.get(`/shap/local?forecast_type=${forecastType}&store_id=${selectedStore}&period=${effectivePeriod}`)
          .then(res => res.data)
          .catch(err => {
            if (err.response?.status === 404) {
              const detail = err.response?.data?.detail || '';
              return { notFound: true, reason: detail.includes('period') ? 'period' : 'store' };
            }
            throw err;
          })
      : Promise.resolve(null),
    [selectedStore, forecastType, effectivePeriod],
    'Failed to load the local explanation for this period.'
  );

  const localExplanation = useMemo(
    () => buildLocalExplanation({ localData, forecasts, selectedStore, forecastType }),
    [localData, forecasts, selectedStore, forecastType]
  );

  useEffect(() => {
    if (localExplanation && !localExplanation.notFound && !localExplanation.reconciliationOk) {
      // eslint-disable-next-line no-console
      console.error('SHAP reconciliation check failed for the selected store/period:', {
        store: localExplanation.store, period: localExplanation.period,
        baseline: localExplanation.baseline, sumShap: localExplanation.sumShap,
        predictedSales: localExplanation.predictedSales,
      });
    }
  }, [localExplanation]);

  return (
    <div className="animate-fadeIn">
      <PageHeader
        icon={Search}
        title="Forecast Explanation"
        subtitle="Understand what influences the model overall, why it produced a selected forecast, and what that forecast means for the business."
      />

      <AboutShapCard />

      <ExplanationTabs activeTab={activeTab} onChange={setActiveTab} />

      <GlobalPanel
        hidden={activeTab !== 'overall'}
        loading={globalLoading} error={globalError} rows={globalRows}
        forecastType={forecastType} cc={cc} isMobile={isMobile} onRetry={refetchGlobal}
      />

      <LocalPanel
        hidden={activeTab !== 'selected'}
        forecastsLoading={forecastsLoading} forecastsError={forecastsError} onRetryForecasts={refetchForecasts}
        localLoading={localLoading} localError={localError} onRetryLocal={refetchLocal}
        forecasts={forecasts} effectivePeriod={effectivePeriod} forecastType={forecastType}
        onPeriodSelect={setSelectedPeriod}
        localExplanation={localExplanation}
        showAllFeatures={showAllFeatures} onToggleShowAll={() => setShowAllFeatures(s => !s)}
        highlightedFeature={highlightedFeature} onHighlight={handleHighlight}
        setActivePage={setActivePage} setHandoffPeriod={setHandoffPeriod}
        cc={cc} isMobile={isMobile}
      />
    </div>
  );
}
