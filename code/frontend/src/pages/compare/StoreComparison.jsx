import React, { useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Building2, Search, Download, RotateCcw, ArrowUpDown, ArrowUp, ArrowDown, ArrowRight,
  ShieldAlert, TrendingUp, BarChart3, Scale, Info, X,
  ChevronLeft, ChevronRight,
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

const MINUS = '−';
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const ROW_HEIGHT = 46;

const FULL_DATE_FMT  = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const MONTH_YEAR_FMT = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

export const DEFAULT_COMPARISON_FILTERS = {
  startPeriod  : null,
  endPeriod    : null,
  search       : '',
  coverage     : 'complete', // 'complete' | 'all'
  direction    : 'all',      // 'all' | 'over' | 'under'
  rankBy       : 'absDifference', // 'absDifference' | 'actual' | 'predicted'
  showMae      : false,
  sortColumn   : 'store_id',
  sortDirection: 'asc',
  page         : 1,
  pageSize     : 25,
};

// ---- Pure helpers — exported for direct unit testing (same rationale as
// ForecastChart.jsx's exported computeMAE/niceDomain/etc: verify exact
// output without fighting Recharts/JSDOM). ----

export function classifyDirection(difference) {
  // Zero difference is the practically-impossible edge case of predicted
  // exactly equalling actual across a whole period range — treated as
  // "over" only for a deterministic bucket, not an editorial judgement.
  return difference >= 0 ? 'over' : 'under';
}

export function filterStores(stores, filters) {
  const q = (filters.search || '').trim();
  return stores.filter((row) => {
    if (q && !String(row.store_id).includes(q)) return false;
    if (filters.coverage === 'complete' && !row.is_complete) return false;
    if (filters.direction !== 'all' && classifyDirection(row.difference) !== filters.direction) return false;
    return true;
  });
}

// Re-applies search+direction only (not coverage) so the "N excluded" note
// stays accurate to the current search/direction context regardless of
// which coverage option is currently selected.
export function countExcludedByCoverage(stores, filters) {
  if (filters.coverage !== 'complete') return 0;
  const q = (filters.search || '').trim();
  return stores.filter((row) => {
    if (q && !String(row.store_id).includes(q)) return false;
    if (filters.direction !== 'all' && classifyDirection(row.difference) !== filters.direction) return false;
    return !row.is_complete;
  }).length;
}

// Summary percentage is summed-difference / summed-actual — never an
// average of each store's own percentage (statistically wrong when stores
// have very different actual-sales magnitudes).
export function computeSummary(filteredStores) {
  const storesIncluded = filteredStores.length;
  const totalPredicted = filteredStores.reduce((s, r) => s + r.total_predicted, 0);
  const totalActual    = filteredStores.reduce((s, r) => s + r.total_actual, 0);
  const netDifference   = totalPredicted - totalActual;
  const netDifferencePct = totalActual !== 0 ? (netDifference / totalActual) * 100 : null;
  return { storesIncluded, totalPredicted, totalActual, netDifference, netDifferencePct };
}

const NUMERIC_COLUMNS = new Set([
  'store_id', 'total_predicted', 'total_actual', 'difference', 'difference_pct', 'mae', 'periods_covered',
]);

export function sortStores(stores, column, direction) {
  const sign = direction === 'desc' ? -1 : 1;
  return [...stores].sort((a, b) => {
    const av = a[column];
    const bv = b[column];
    if (NUMERIC_COLUMNS.has(column)) {
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1;  // nulls always sort last, regardless of direction
      if (bNull) return -1;
      return (av - bv) * sign;
    }
    return String(av).localeCompare(String(bv)) * sign;
  });
}

const RANK_METRIC = {
  absDifference: row => row.absolute_difference,
  actual       : row => row.total_actual,
  predicted    : row => row.total_predicted,
};

export function rankForChart(filteredStores, rankBy, limit = 10) {
  const metric = RANK_METRIC[rankBy] || RANK_METRIC.absDifference;
  return [...filteredStores]
    .sort((a, b) => {
      const diff = metric(b) - metric(a);
      return diff !== 0 ? diff : a.store_id - b.store_id; // deterministic tie-break
    })
    .slice(0, limit);
}

// Zero-based, headroom-padded axis domain (same idea as ForecastChart.jsx's
// niceDomain, reimplemented locally per this codebase's convention of
// duplicating such small chart utilities per file).
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

export function formatCoverageLabel(row, forecastType) {
  const unit = forecastType === 'weekly' ? 'weeks' : 'months';
  return `${row.periods_covered}/${row.periods_expected} ${unit}`;
}

function csvEscape(value) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// CSV export uses plain, full-precision signed numbers (ASCII '-', no
// thousands separators, no unicode minus) for numeric columns — this
// deliberately diverges from the on-screen table's styled formatting so
// spreadsheet software parses these as real numbers, not text. Always
// includes MAE regardless of the "Show MAE" display toggle, since the
// export is a complete data dump independent of the current view.
export function buildComparisonCsv(filteredStores, meta) {
  const { forecastType, startPeriod, endPeriod } = meta;
  const headers = [
    'Store', 'Granularity', 'Period Range', 'Total Predicted Sales', 'Total Actual Sales',
    'Difference', 'Difference (%)', 'Period Coverage', 'MAE',
  ];
  const periodRange = `${startPeriod} to ${endPeriod}`;
  const lines = [headers.map(csvEscape).join(',')];
  filteredStores.forEach((row) => {
    lines.push([
      row.store_id,
      forecastType,
      csvEscape(periodRange),
      row.total_predicted,
      row.total_actual,
      row.difference,
      row.difference_pct != null ? row.difference_pct : '',
      csvEscape(formatCoverageLabel(row, forecastType)),
      row.mae,
    ].join(','));
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

function toDate(period) {
  return new Date(`${period}T00:00:00`);
}

function formatPeriodOption(period, forecastType) {
  return forecastType === 'weekly' ? FULL_DATE_FMT.format(toDate(period)) : MONTH_YEAR_FMT.format(toDate(period));
}

function formatDateRangeLabel(startPeriod, endPeriod, forecastType) {
  if (!startPeriod || !endPeriod) return '';
  return `${formatPeriodOption(startPeriod, forecastType)} – ${formatPeriodOption(endPeriod, forecastType)}`;
}

function formatMoney(v) {
  return Math.round(v).toLocaleString('en-US');
}

function formatSigned(v) {
  const rounded = Math.round(v);
  return `${rounded >= 0 ? '+' : MINUS}${Math.abs(rounded).toLocaleString('en-US')}`;
}

function formatPct(v) {
  if (v == null) return 'N/A';
  return `${v >= 0 ? '+' : MINUS}${Math.abs(v).toFixed(1)}%`;
}

// ---- Presentational subcomponents ----

// Chips describe every filter currently deviating from its default, each
// removable independently — resetting only that one field rather than the
// whole filter set (DEFAULT_COMPARISON_FILTERS.onReset handles the "clear
// everything" case separately).
function buildActiveFilterChips(filters, updateFilter) {
  const chips = [];
  const search = (filters.search || '').trim();
  if (search) {
    chips.push({
      key: 'search',
      label: `Store contains "${search}"`,
      onRemove: () => updateFilter({ search: '' }),
    });
  }
  if (filters.direction !== 'all') {
    chips.push({
      key: 'direction',
      label: `Direction: ${filters.direction === 'over' ? 'Overprediction' : 'Underprediction'}`,
      onRemove: () => updateFilter({ direction: 'all' }),
    });
  }
  if (filters.coverage !== 'complete') {
    chips.push({
      key: 'coverage',
      label: 'Including incomplete coverage',
      onRemove: () => updateFilter({ coverage: 'complete' }),
    });
  }
  return chips;
}

function ActiveFiltersRow({ filters, updateFilter, matchCount, totalCount }) {
  const chips = buildActiveFilterChips(filters, updateFilter);
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60">
      <div className="flex items-center gap-1.5 flex-wrap min-h-[26px]">
        {chips.length === 0 ? (
          <span className="text-xs text-gray-400 dark:text-gray-500">No filters applied</span>
        ) : chips.map(chip => (
          <span
            key={chip.key}
            className="badge bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 gap-1 pr-1.5"
          >
            {chip.label}
            <button
              type="button"
              onClick={chip.onRemove}
              aria-label={`Remove filter: ${chip.label}`}
              className="flex items-center justify-center w-4 h-4 rounded-full hover:bg-gray-200
                         dark:hover:bg-gray-600 focus:outline-none focus-visible:ring-2
                         focus-visible:ring-indigo-400"
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <p
        className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0"
        title="Stores matching the current search, direction and coverage filters, out of all stores available for the selected period range."
      >
        {matchCount.toLocaleString('en-US')} of {totalCount.toLocaleString('en-US')} stores match filters
      </p>
    </div>
  );
}

function ComparisonControls({
  forecastType, setForecastType, filters, setFilters, availablePeriods, onReset, matchCount, totalCount,
}) {
  const updateFilter = (patch) => setFilters(f => ({ ...f, ...patch, page: 1 }));
  const startValue = filters.startPeriod || availablePeriods[0] || '';
  const endValue   = filters.endPeriod   || availablePeriods[availablePeriods.length - 1] || '';

  return (
    <div className="card mb-4 !py-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="field-label block mb-1" id="comparison-granularity-label">Granularity</label>
          <div
            role="radiogroup"
            aria-labelledby="comparison-granularity-label"
            className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600
                       bg-gray-50 dark:bg-gray-900 p-0.5"
          >
            {[['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([value, label]) => {
              const selected = forecastType === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setForecastType(value)}
                  className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors min-h-[40px]
                             focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                    selected
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="comparison-start-period" className="field-label block mb-1">Start period</label>
          <select
            id="comparison-start-period"
            value={startValue}
            onChange={e => updateFilter({ startPeriod: e.target.value })}
            className="input-field !w-auto min-h-[44px]"
          >
            {availablePeriods.map(p => (
              <option key={p} value={p}>{formatPeriodOption(p, forecastType)}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="comparison-end-period" className="field-label block mb-1">End period</label>
          <select
            id="comparison-end-period"
            value={endValue}
            onChange={e => updateFilter({ endPeriod: e.target.value })}
            className="input-field !w-auto min-h-[44px]"
          >
            {availablePeriods.map(p => (
              <option key={p} value={p}>{formatPeriodOption(p, forecastType)}</option>
            ))}
          </select>
        </div>

        <div className="w-full sm:w-auto">
          <label htmlFor="comparison-search" className="field-label block mb-1">Store number</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              id="comparison-search"
              type="text"
              inputMode="numeric"
              placeholder="Search store number"
              value={filters.search}
              onChange={e => updateFilter({ search: e.target.value })}
              // !pl-8/!pr-8 are load-bearing: .input-field's own shorthand
              // `padding` rule is defined later in index.css than Tailwind's
              // utilities, so an un-flagged pl-8 is silently overridden back
              // to .input-field's 1rem default — that was the cause of the
              // search icon overlapping typed text.
              className="input-field !pl-8 !pr-8 w-full sm:!w-52 min-h-[44px]"
            />
            {filters.search && (
              <button
                type="button"
                onClick={() => updateFilter({ search: '' })}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center
                           w-7 h-7 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200
                           hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none
                           focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="comparison-coverage" className="field-label block mb-1">Coverage</label>
          <select
            id="comparison-coverage"
            value={filters.coverage}
            onChange={e => updateFilter({ coverage: e.target.value })}
            className="input-field !w-auto min-h-[44px]"
          >
            <option value="complete">Complete coverage only</option>
            <option value="all">Include incomplete stores</option>
          </select>
        </div>

        <div>
          <label htmlFor="comparison-direction" className="field-label block mb-1">Direction</label>
          <select
            id="comparison-direction"
            value={filters.direction}
            onChange={e => updateFilter({ direction: e.target.value })}
            className="input-field !w-auto min-h-[44px]"
          >
            <option value="all">All</option>
            <option value="over">Overprediction</option>
            <option value="under">Underprediction</option>
          </select>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300
                     hover:text-indigo-600 dark:hover:text-indigo-400 min-h-[44px] px-3 ml-auto
                     border-l border-gray-200 dark:border-gray-700 whitespace-nowrap flex-shrink-0
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
        >
          <RotateCcw size={14} /> Reset filters
        </button>
      </div>

      <ActiveFiltersRow
        filters={filters}
        updateFilter={updateFilter}
        matchCount={matchCount}
        totalCount={totalCount}
      />
    </div>
  );
}

function SummaryCards({ summary, excludedCount, filters, dateRangeLabel, periodCount, forecastType }) {
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400 mb-4">
        <span className="badge bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {forecastType === 'weekly' ? 'Weekly' : 'Monthly'}
        </span>
        <span aria-hidden="true">·</span>
        <span>{dateRangeLabel}</span>
        <span aria-hidden="true">·</span>
        <span>{periodCount} {forecastType === 'weekly' ? 'weeks' : 'months'}</span>
        {filters.coverage === 'complete' && excludedCount > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span>{excludedCount} store{excludedCount === 1 ? '' : 's'} excluded (incomplete coverage)</span>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Stores included"
          value={summary.storesIncluded.toLocaleString('en-US')}
          icon={Building2}
          tone="primary"
          sublabel={filters.coverage === 'all' && excludedCount > 0
            ? `${excludedCount} with incomplete coverage`
            : undefined}
        />
        <KpiCard
          label="Total predicted sales"
          value={formatMoney(summary.totalPredicted)}
          icon={TrendingUp}
          tone="neutral"
        />
        <KpiCard
          label="Total actual sales"
          value={formatMoney(summary.totalActual)}
          icon={BarChart3}
          tone="neutral"
        />
        <KpiCard
          label="Net difference"
          value={formatSigned(summary.netDifference)}
          icon={Scale}
          tone="neutral"
          sublabel={summary.netDifferencePct != null
            ? `${formatPct(summary.netDifferencePct)} of actual`
            : 'N/A — zero actual sales in range'}
        />
      </div>
    </>
  );
}

function ComparisonTooltip({ active, payload, forecastType }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700
                    shadow-lg px-4 py-3 text-xs min-w-[200px]">
      <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Store {row.store_id}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-500 dark:text-gray-400">Predicted total</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">{formatMoney(row.total_predicted)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-500 dark:text-gray-400">Actual total</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">{formatMoney(row.total_actual)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-500 dark:text-gray-400">Difference</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">{formatSigned(row.difference)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-500 dark:text-gray-400">Difference %</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">{formatPct(row.difference_pct)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-500 dark:text-gray-400">Coverage</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">{formatCoverageLabel(row, forecastType)}</span>
        </div>
      </div>
    </div>
  );
}

const RANK_OPTIONS = [
  { value: 'absDifference', label: 'Largest absolute difference' },
  { value: 'actual',        label: 'Highest actual sales' },
  { value: 'predicted',     label: 'Highest predicted sales' },
];

function ComparisonChart({ chartStores, totalFiltered, filters, setFilters, forecastType, cc, isMobile }) {
  const yDomain = useMemo(
    () => niceDomain(chartStores.flatMap(r => [r.total_predicted, r.total_actual])),
    [chartStores]
  );
  const height = Math.max(240, chartStores.length * ROW_HEIGHT + 40);

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-4 flex-wrap">
          <h2 className="card-title mb-0">Predicted vs actual sales by store</h2>
          {/* Legend lives beside the title — identifiable before scrolling
              down to the bars themselves, especially with 10 store rows. */}
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: cc.chart.predicted }} />
              Predicted
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: cc.chart.actual }} />
              Actual
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="comparison-rank-by" className="field-label">Rank by</label>
          <select
            id="comparison-rank-by"
            value={filters.rankBy}
            onChange={e => setFilters(f => ({ ...f, rankBy: e.target.value }))}
            className="input-field !w-auto !py-1.5 text-xs min-h-[36px]"
          >
            {RANK_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      </div>
      <p className="text-secondary text-xs mb-3">Showing {chartStores.length} of {totalFiltered} stores</p>

      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartStores} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} horizontal={false} />
            <XAxis
              type="number"
              domain={yDomain}
              tickCount={isMobile ? 4 : 6}
              tick={{ fontSize: 11, fill: cc.axisTick }}
              tickFormatter={v => compactNumber.format(v)}
            />
            <YAxis
              type="category"
              dataKey="store_id"
              width={44}
              tick={{ fontSize: 11, fill: cc.axisTick }}
              tickFormatter={v => `#${v}`}
            />
            <Tooltip content={<ComparisonTooltip forecastType={forecastType} />} />
            <Bar dataKey="total_predicted" name="Predicted" fill={cc.chart.predicted} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            <Bar dataKey="total_actual" name="Actual" fill={cc.chart.actual} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SortableHeader({ column, label, sortColumn, sortDirection, onSort, numeric, sticky }) {
  const active = sortColumn === column;
  const ariaSort = active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-3 py-1.5 whitespace-nowrap ${numeric ? 'text-right' : 'text-left'} ${
        sticky ? 'sticky left-0 z-10 bg-gray-50 dark:bg-gray-900' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
      >
        {label}
        {active
          ? (sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
          : <ArrowUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  );
}

function Pagination({ page, pageSize, totalRows, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const startIdx = totalRows === 0 ? 0 : (clampedPage - 1) * pageSize + 1;
  const endIdx = Math.min(clampedPage * pageSize, totalRows);

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap mt-4 text-xs text-gray-500 dark:text-gray-400">
      <p>
        {totalRows === 0
          ? 'No results'
          : `Showing ${startIdx.toLocaleString('en-US')}–${endIdx.toLocaleString('en-US')} of ${totalRows.toLocaleString('en-US')}`}
      </p>
      <div className="flex items-center gap-3">
        <label htmlFor="comparison-page-size" className="flex items-center gap-1.5">
          Rows per page
          <select
            id="comparison-page-size"
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            className="input-field !w-auto !py-1 text-xs min-h-[36px]"
          >
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={clampedPage <= 1}
            onClick={() => onPageChange(clampedPage - 1)}
            aria-label="Previous page"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg
                       text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700
                       disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none
                       focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <ChevronLeft size={14} />
          </button>
          <span>Page {clampedPage} of {totalPages}</span>
          <button
            type="button"
            disabled={clampedPage >= totalPages}
            onClick={() => onPageChange(clampedPage + 1)}
            aria-label="Next page"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg
                       text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700
                       disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none
                       focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ComparisonTable({ sortedStores, filters, setFilters, forecastType, onViewForecast, onDownload }) {
  const totalRows = sortedStores.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / filters.pageSize));
  const clampedPage = Math.min(Math.max(1, filters.page), totalPages);
  const pageRows = sortedStores.slice((clampedPage - 1) * filters.pageSize, clampedPage * filters.pageSize);

  const handleSort = (column) => {
    setFilters(f => ({
      ...f,
      sortColumn: column,
      sortDirection: f.sortColumn === column && f.sortDirection === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortProps = { sortColumn: filters.sortColumn, sortDirection: filters.sortDirection, onSort: handleSort };

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="card-title mb-0">Store comparison</h2>
        <div className="flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.showMae}
              onChange={e => setFilters(f => ({ ...f, showMae: e.target.checked }))}
              className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-400"
            />
            Show MAE
          </label>
          <button
            type="button"
            onClick={onDownload}
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400
                       hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
                       rounded min-h-[44px] px-2 whitespace-nowrap flex-shrink-0"
          >
            <Download size={14} aria-hidden="true" /> Download filtered results
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="table-header">
              <SortableHeader column="store_id" label="Store" numeric sticky {...sortProps} />
              <SortableHeader column="total_predicted" label="Total Predicted" numeric {...sortProps} />
              <SortableHeader column="total_actual" label="Total Actual" numeric {...sortProps} />
              <SortableHeader column="difference" label="Difference" numeric {...sortProps} />
              <SortableHeader column="difference_pct" label="Difference (%)" numeric {...sortProps} />
              <SortableHeader column="periods_covered" label="Coverage" {...sortProps} />
              {filters.showMae && <SortableHeader column="mae" label="MAE" numeric {...sortProps} />}
              <th scope="col" className="px-3 py-1.5 text-left whitespace-nowrap">Result</th>
              <th scope="col" className="px-3 py-1.5 text-left rounded-r-xl whitespace-nowrap">Forecast</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const direction = classifyDirection(row.difference);
              return (
                <tr key={row.store_id} className="table-row">
                  <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-200 sticky left-0
                                 bg-white dark:bg-gray-800 whitespace-nowrap">
                    Store {row.store_id}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-200">
                    {formatMoney(row.total_predicted)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-200">
                    {formatMoney(row.total_actual)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-300">
                    {formatSigned(row.difference)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">
                    {formatPct(row.difference_pct)}
                  </td>
                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300 tabular-nums whitespace-nowrap">
                    {formatCoverageLabel(row, forecastType)}
                    {!row.is_complete && (
                      <span className="badge bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 ml-1.5">
                        Incomplete
                      </span>
                    )}
                  </td>
                  {filters.showMae && (
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">
                      {formatMoney(row.mae)}
                    </td>
                  )}
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {/* Neutral gray for both directions — deliberately distinct from the
                        chart's indigo/orange series colours (which map to Actual/Predicted,
                        not to over/under) — an icon plus explicit text carries the meaning
                        instead of a colour that could be misread as matching the chart. */}
                    <span className="badge bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 gap-1">
                      {direction === 'over' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                      {direction === 'over' ? 'Overprediction' : 'Underprediction'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onViewForecast(row.store_id)}
                      className="flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400
                                 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
                                 rounded min-h-[36px] px-1 whitespace-nowrap"
                    >
                      View forecast <ArrowRight size={12} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        page={filters.page}
        pageSize={filters.pageSize}
        totalRows={totalRows}
        onPageChange={(p) => setFilters(f => ({ ...f, page: p }))}
        onPageSizeChange={(size) => setFilters(f => ({ ...f, pageSize: size, page: 1 }))}
      />
    </div>
  );
}

function AboutSection() {
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-700/60 bg-gray-50/60
                    dark:bg-gray-800/40 px-5 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Info size={14} className="text-indigo-500 dark:text-indigo-400 flex-shrink-0" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">About these calculations</h2>
      </div>
      <p className="text-secondary text-xs max-w-3xl">
        Difference = total predicted − total actual. Totals can hide offsetting weekly or monthly errors —
        MAE reflects period-level error magnitude even when totals net to near zero.
      </p>

      <details className="text-xs mt-1.5">
        <summary className="cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
          Detailed definitions
        </summary>
        <ul className="text-secondary space-y-1 list-disc list-inside max-w-3xl mt-2">
          <li>Totals are full-precision sums of predicted and actual sales across the selected periods; only the displayed values are rounded.</li>
          <li>A store's own Difference (%) divides its own difference by its own actual sales.</li>
          <li>The summary cards' overall percentage divides the summed difference by the summed actual sales across all filtered stores — it is not an average of each store's percentage.</li>
          <li>MAE is the mean of period-level absolute errors.</li>
          <li>Stores with zero actual sales in the selected range show N/A for percentage figures rather than a divide-by-zero result.</li>
          <li>Missing periods are never treated as zero — coverage reflects only the periods actually present in the precomputed artefact.</li>
        </ul>
      </details>
    </div>
  );
}

// ---- Main page ----

export default function StoreComparison({
  forecastType, setForecastType, setSelectedStore, setActivePage, filters, setFilters, user,
}) {
  const cc = useChartColors();
  const isMobile = useIsMobile();
  const prevForecastType = useRef(forecastType);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ forecast_type: forecastType });
    if (filters.startPeriod) params.set('start_period', filters.startPeriod);
    if (filters.endPeriod) params.set('end_period', filters.endPeriod);
    return params.toString();
  }, [forecastType, filters.startPeriod, filters.endPeriod]);

  const isAdmin = user?.role === 'admin';

  // The fetcher itself skips the network call for a non-admin rather than
  // conditionally skipping the useApi hook call — the admin gate below is a
  // render-time return, and hooks must still run unconditionally on every
  // render of this component instance (Rules of Hooks / CRA's ESLint would
  // otherwise fail the build on an early return placed above a hook).
  const { data, loading, error, refetch } = useApi(
    () => (isAdmin
      ? client.get(`/forecast/stores/comparison?${queryString}`).then(res => res.data)
      : Promise.resolve(null)),
    [queryString, isAdmin],
    'Failed to load store comparison data. Make sure the backend is running.'
  );

  // Reset a stale period range only when forecastType actually changes
  // (not on mount) — a weekly period like 2015-05-11 is invalid once the
  // granularity switches to monthly and would otherwise trip the
  // backend's 400 validation.
  useEffect(() => {
    if (prevForecastType.current !== forecastType) {
      setFilters(f => ({ ...f, startPeriod: null, endPeriod: null, page: 1 }));
      prevForecastType.current = forecastType;
    }
  }, [forecastType, setFilters]);

  const stores = useMemo(() => data?.stores || [], [data]);
  const filteredStores = useMemo(() => filterStores(stores, filters), [stores, filters]);
  const summary = useMemo(() => computeSummary(filteredStores), [filteredStores]);
  const excludedCount = useMemo(() => countExcludedByCoverage(stores, filters), [stores, filters]);
  const sortedStores = useMemo(
    () => sortStores(filteredStores, filters.sortColumn, filters.sortDirection),
    [filteredStores, filters.sortColumn, filters.sortDirection]
  );
  const chartStores = useMemo(() => rankForChart(filteredStores, filters.rankBy, 10), [filteredStores, filters.rankBy]);

  if (user?.role !== 'admin') {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700
                      dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400
                      rounded-2xl p-6 text-center text-sm flex flex-col
                      items-center gap-2">
        <ShieldAlert size={20} />
        Access denied. Admin role required.
      </div>
    );
  }

  if (loading) return (
    <div className="animate-fadeIn">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
      <div className="mb-6"><SkeletonChart height={320} /></div>
      <SkeletonTable rows={8} cols={6} />
    </div>
  );

  if (error) return <AlertBanner variant="error" onRetry={refetch}>{error}</AlertBanner>;

  if (stores.length === 0) return (
    <EmptyState
      title="No comparison data available"
      message="No precomputed predictions were found for this forecast type."
    />
  );

  const { start_period: startPeriod, end_period: endPeriod, available_periods: availablePeriods, period_count: periodCount } = data;
  const dateRangeLabel = formatDateRangeLabel(startPeriod, endPeriod, forecastType);

  const handleViewForecast = (storeId) => {
    setSelectedStore(storeId);
    setActivePage('forecast');
  };

  const handleReset = () => setFilters(DEFAULT_COMPARISON_FILTERS);

  const handleDownload = () => {
    const csv = buildComparisonCsv(filteredStores, { forecastType, startPeriod, endPeriod });
    downloadCsv(csv, `store_comparison_${forecastType}_${startPeriod}_to_${endPeriod}.csv`);
  };

  return (
    <div className="animate-fadeIn">
      <PageHeader
        icon={Building2}
        title="Store Comparison"
        subtitle="Compare predicted and actual sales across stores in the held-out evaluation period."
      />

      <ComparisonControls
        forecastType={forecastType}
        setForecastType={setForecastType}
        filters={filters}
        setFilters={setFilters}
        availablePeriods={availablePeriods}
        onReset={handleReset}
        matchCount={filteredStores.length}
        totalCount={stores.length}
      />

      <SummaryCards
        summary={summary}
        excludedCount={excludedCount}
        filters={filters}
        dateRangeLabel={dateRangeLabel}
        periodCount={periodCount}
        forecastType={forecastType}
      />

      {filteredStores.length === 0 ? (
        <div className="card mb-6">
          <EmptyState
            title="No stores match the current filters"
            message="Try widening the period range or clearing the search, direction, or coverage filters."
            action={
              <button type="button" onClick={handleReset} className="btn-primary">
                Reset filters
              </button>
            }
          />
        </div>
      ) : (
        <>
          <ComparisonChart
            chartStores={chartStores}
            totalFiltered={filteredStores.length}
            filters={filters}
            setFilters={setFilters}
            forecastType={forecastType}
            cc={cc}
            isMobile={isMobile}
          />

          <ComparisonTable
            sortedStores={sortedStores}
            filters={filters}
            setFilters={setFilters}
            forecastType={forecastType}
            onViewForecast={handleViewForecast}
            onDownload={handleDownload}
          />
        </>
      )}

      <AboutSection />
    </div>
  );
}
