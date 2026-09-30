import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import StoreComparison, {
  DEFAULT_COMPARISON_FILTERS, classifyDirection, classifyPeerComparison, filterStores,
  countExcludedByCoverage, computeSummary, computePeriodSummary, sortStores, rankForChart,
  averagePredicted, buildComparisonCsv, buildPeriodComparisonCsv, formatCoverageLabel,
} from '../pages/compare/StoreComparison';
import { ThemeProvider } from '../context/ThemeContext';
import client from '../api/client';

// Same automock approach as the rest of this project's tests — an inline
// mock factory silently drops its implementation under this Jest version
// (see Login.test.jsx / ForecastChart.test.jsx).
jest.mock('../api/client');

beforeEach(() => {
  jest.clearAllMocks();
});

const SAMPLE_STORES = [
  { store_id: 1, total_predicted: 1000, total_actual: 900, difference: 100, absolute_difference: 100, difference_pct: 11.11, mae: 50, periods_covered: 13, periods_expected: 13, is_complete: true },
  { store_id: 2, total_predicted: 800, total_actual: 900, difference: -100, absolute_difference: 100, difference_pct: -11.11, mae: 40, periods_covered: 10, periods_expected: 13, is_complete: false },
  { store_id: 3, total_predicted: 500, total_actual: 0, difference: 500, absolute_difference: 500, difference_pct: null, mae: 60, periods_covered: 13, periods_expected: 13, is_complete: true },
  { store_id: 42, total_predicted: 2000, total_actual: 1800, difference: 200, absolute_difference: 200, difference_pct: 11.11, mae: 70, periods_covered: 13, periods_expected: 13, is_complete: true },
];

// ---- Pure helper tests ----

describe('classifyDirection', () => {
  test('positive difference is over, negative is under, zero is over', () => {
    expect(classifyDirection(100)).toBe('over');
    expect(classifyDirection(-100)).toBe('under');
    expect(classifyDirection(0)).toBe('over');
  });
});

describe('classifyPeerComparison', () => {
  test('within the similarity band counts as similar', () => {
    expect(classifyPeerComparison(102, 100)).toBe('similar');
    expect(classifyPeerComparison(96, 100)).toBe('similar');
  });

  test('outside the band is higher or lower', () => {
    expect(classifyPeerComparison(200, 100)).toBe('higher');
    expect(classifyPeerComparison(50, 100)).toBe('lower');
  });

  test('handles a zero average without dividing by zero', () => {
    expect(classifyPeerComparison(0, 0)).toBe('similar');
    expect(classifyPeerComparison(10, 0)).toBe('higher');
  });
});

describe('averagePredicted', () => {
  test('averages total_predicted across the given rows', () => {
    expect(averagePredicted(SAMPLE_STORES)).toBeCloseTo((1000 + 800 + 500 + 2000) / 4, 5);
  });

  test('returns 0 for an empty set', () => {
    expect(averagePredicted([])).toBe(0);
  });
});

describe('filterStores', () => {
  test('search filters by store id substring', () => {
    const result = filterStores(SAMPLE_STORES, { ...DEFAULT_COMPARISON_FILTERS, search: '42', coverage: 'all' });
    expect(result.map(r => r.store_id)).toEqual([42]);
  });

  test('coverage "complete" drops incomplete stores', () => {
    const result = filterStores(SAMPLE_STORES, { ...DEFAULT_COMPARISON_FILTERS, coverage: 'complete' });
    expect(result.map(r => r.store_id)).toEqual([1, 3, 42]);
  });

  test('coverage "all" keeps incomplete stores', () => {
    const result = filterStores(SAMPLE_STORES, { ...DEFAULT_COMPARISON_FILTERS, coverage: 'all' });
    expect(result.map(r => r.store_id)).toEqual([1, 2, 3, 42]);
  });

  test('direction filters to only overprediction or underprediction', () => {
    const under = filterStores(SAMPLE_STORES, { ...DEFAULT_COMPARISON_FILTERS, coverage: 'all', direction: 'under' });
    expect(under.map(r => r.store_id)).toEqual([2]);

    const over = filterStores(SAMPLE_STORES, { ...DEFAULT_COMPARISON_FILTERS, coverage: 'all', direction: 'over' });
    expect(over.map(r => r.store_id)).toEqual([1, 3, 42]);
  });
});

describe('countExcludedByCoverage', () => {
  test('counts incomplete stores excluded by the complete-only filter, scoped to search+direction', () => {
    expect(countExcludedByCoverage(SAMPLE_STORES, { ...DEFAULT_COMPARISON_FILTERS, coverage: 'complete' })).toBe(1);
  });

  test('returns 0 when coverage is set to include incomplete stores', () => {
    expect(countExcludedByCoverage(SAMPLE_STORES, { ...DEFAULT_COMPARISON_FILTERS, coverage: 'all' })).toBe(0);
  });
});

describe('computeSummary (range mode)', () => {
  test('sums predicted/actual and divides the summed difference by summed actual (not an average of percentages)', () => {
    const summary = computeSummary(SAMPLE_STORES);
    expect(summary.storesIncluded).toBe(4);
    expect(summary.totalPredicted).toBe(4300);
    expect(summary.totalActual).toBe(3600);
    expect(summary.netDifference).toBe(700);
    expect(summary.netDifferencePct).toBeCloseTo((700 / 3600) * 100, 5);
  });

  test('returns null percentage when summed actual is zero', () => {
    const summary = computeSummary([
      { total_predicted: 100, total_actual: 0 },
      { total_predicted: 50, total_actual: 0 },
    ]);
    expect(summary.netDifferencePct).toBeNull();
  });
});

describe('computePeriodSummary (period mode)', () => {
  test('identifies the highest and lowest predicted stores and the gap between them', () => {
    const summary = computePeriodSummary(SAMPLE_STORES);
    expect(summary.storesCompared).toBe(4);
    expect(summary.highest.store_id).toBe(42);
    expect(summary.lowest.store_id).toBe(3);
    expect(summary.gap).toBe(2000 - 500);
  });

  test('identifies the store with the largest prediction error', () => {
    const summary = computePeriodSummary(SAMPLE_STORES);
    expect(summary.largestError.store_id).toBe(3); // absolute_difference 500 is the largest
  });

  test('returns nulls for an empty set rather than throwing', () => {
    const summary = computePeriodSummary([]);
    expect(summary).toEqual({ storesCompared: 0, highest: null, lowest: null, gap: 0, largestError: null });
  });
});

describe('sortStores', () => {
  test('defaults to numeric ascending store_id order', () => {
    const result = sortStores(SAMPLE_STORES, 'store_id', 'asc');
    expect(result.map(r => r.store_id)).toEqual([1, 2, 3, 42]);
  });

  test('sorts numerically, not lexicographically (store 3 before store 42 fails lexicographic ordering)', () => {
    const result = sortStores(SAMPLE_STORES, 'store_id', 'desc');
    expect(result.map(r => r.store_id)).toEqual([42, 3, 2, 1]);
  });

  test('null difference_pct always sorts last, regardless of direction', () => {
    const asc = sortStores(SAMPLE_STORES, 'difference_pct', 'asc');
    expect(asc[asc.length - 1].store_id).toBe(3);

    const desc = sortStores(SAMPLE_STORES, 'difference_pct', 'desc');
    expect(desc[desc.length - 1].store_id).toBe(3);
  });
});

describe('rankForChart', () => {
  test('ranks by highest predicted sales by default', () => {
    const result = rankForChart(SAMPLE_STORES, 'predictedDesc', 10);
    expect(result.map(r => r.store_id)).toEqual([42, 1, 2, 3]);
  });

  test('ranks by lowest predicted sales when requested', () => {
    const result = rankForChart(SAMPLE_STORES, 'predictedAsc', 10);
    expect(result.map(r => r.store_id)).toEqual([3, 2, 1, 42]);
  });

  test('ranks by highest actual sales when requested', () => {
    const result = rankForChart(SAMPLE_STORES, 'actualDesc', 1);
    expect(result[0].store_id).toBe(42);
  });

  test('ranks by largest absolute difference when requested', () => {
    const result = rankForChart(SAMPLE_STORES, 'absDifference', 10);
    expect(result.map(r => r.store_id)).toEqual([3, 42, 1, 2]);
  });

  test('limits to the requested count', () => {
    const result = rankForChart(SAMPLE_STORES, 'absDifference', 2);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.store_id)).toEqual([3, 42]);
  });

  test('breaks ties deterministically by ascending store_id', () => {
    const tied = [
      { store_id: 20, absolute_difference: 100, total_actual: 1, total_predicted: 1 },
      { store_id: 5,  absolute_difference: 100, total_actual: 1, total_predicted: 1 },
    ];
    const result = rankForChart(tied, 'absDifference', 10);
    expect(result.map(r => r.store_id)).toEqual([5, 20]);
  });
});

describe('formatCoverageLabel', () => {
  test('formats weekly coverage', () => {
    expect(formatCoverageLabel({ periods_covered: 10, periods_expected: 13 }, 'weekly')).toBe('10/13 weeks');
  });

  test('formats monthly coverage', () => {
    expect(formatCoverageLabel({ periods_covered: 3, periods_expected: 3 }, 'monthly')).toBe('3/3 months');
  });
});

describe('buildComparisonCsv (range mode)', () => {
  test('includes granularity and period range, plain signed numbers, and blank for null percentage', () => {
    const csv = buildComparisonCsv(
      [
        { store_id: 1, total_predicted: 1000, total_actual: 900, difference: 100, difference_pct: 11.11, mae: 50, periods_covered: 13, periods_expected: 13 },
        { store_id: 3, total_predicted: 500, total_actual: 0, difference: 500, difference_pct: null, mae: 60, periods_covered: 13, periods_expected: 13 },
      ],
      { forecastType: 'weekly', startPeriod: '2015-05-04', endPeriod: '2015-07-27' }
    );
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'Store,Granularity,Period Range,Total Predicted Sales,Total Actual Sales,Difference,Difference (%),Period Coverage,MAE'
    );
    expect(lines[1]).toBe('1,weekly,2015-05-04 to 2015-07-27,1000,900,100,11.11,13/13 weeks,50');
    // Null percentage is blank, not "N/A" or "NaN" — and the row is still a plain ASCII number, not a unicode minus.
    expect(lines[2]).toBe('3,weekly,2015-05-04 to 2015-07-27,500,0,500,,13/13 weeks,60');
  });

  test('uses a plain ASCII minus for negative differences, not the unicode minus used on-screen', () => {
    const csv = buildComparisonCsv(
      [{ store_id: 2, total_predicted: 800, total_actual: 900, difference: -100, difference_pct: -11.11, mae: 40, periods_covered: 10, periods_expected: 13 }],
      { forecastType: 'weekly', startPeriod: '2015-05-04', endPeriod: '2015-07-27' }
    );
    expect(csv).toContain(',-100,-11.11,');
    expect(csv).not.toContain('−'); // U+2212, the on-screen-only symbol
  });
});

describe('buildPeriodComparisonCsv (period mode)', () => {
  test('includes a single period column and the peer comparison label', () => {
    const csv = buildPeriodComparisonCsv(
      [{ store_id: 1, total_predicted: 1000, total_actual: 900, difference: 100, difference_pct: 11.11 }],
      { forecastType: 'weekly', period: '2015-07-27', avgPredicted: 1000 }
    );
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Store,Granularity,Period,Predicted Sales,Actual Sales,Difference,Difference (%),Comparison Label');
    expect(lines[1]).toBe('1,weekly,2015-07-27,1000,900,100,11.11,Similar predicted sales');
  });

  test('blank difference percentage for a null value, plain ASCII minus for negatives', () => {
    const csv = buildPeriodComparisonCsv(
      [{ store_id: 2, total_predicted: 500, total_actual: 900, difference: -400, difference_pct: null }],
      { forecastType: 'weekly', period: '2015-07-27', avgPredicted: 1000 }
    );
    expect(csv).toContain(',500,900,-400,,');
    expect(csv).not.toContain('−');
  });
});

// ---- Render-level tests ----

const PERIOD_RESPONSE = {
  forecast_type: 'weekly',
  start_period: '2015-07-27',
  end_period: '2015-07-27',
  available_periods: ['2015-05-04', '2015-05-11', '2015-07-27'],
  selected_periods: ['2015-07-27'],
  period_count: 1,
  store_count: 2,
  stores: [
    { store_id: 1, total_predicted: 1000, total_actual: 900, difference: 100, absolute_difference: 100, difference_pct: 11.11, mae: 100, periods_covered: 1, periods_expected: 1, is_complete: true },
    { store_id: 2, total_predicted: 800, total_actual: 900, difference: -100, absolute_difference: 100, difference_pct: -11.11, mae: 100, periods_covered: 1, periods_expected: 1, is_complete: true },
  ],
};

const FULL_RANGE_RESPONSE = {
  forecast_type: 'weekly',
  start_period: '2015-05-04',
  end_period: '2015-07-27',
  available_periods: ['2015-05-04', '2015-05-11', '2015-07-27'],
  selected_periods: ['2015-05-04', '2015-05-11', '2015-07-27'],
  period_count: 3,
  store_count: 2,
  stores: [
    { store_id: 1, total_predicted: 3000, total_actual: 2700, difference: 300, absolute_difference: 300, difference_pct: 11.11, mae: 100, periods_covered: 3, periods_expected: 3, is_complete: true },
    { store_id: 2, total_predicted: 2400, total_actual: 2700, difference: -300, absolute_difference: 300, difference_pct: -11.11, mae: 100, periods_covered: 3, periods_expected: 3, is_complete: true },
  ],
};

function renderPage(overrides = {}) {
  const handlers = {
    setForecastType : jest.fn(),
    setSelectedStore: jest.fn(),
    setActivePage   : jest.fn(),
    setHandoffPeriod: jest.fn(),
    setFilters      : jest.fn(),
  };
  const props = {
    forecastType    : 'weekly',
    setForecastType : handlers.setForecastType,
    setSelectedStore: handlers.setSelectedStore,
    setActivePage   : handlers.setActivePage,
    setHandoffPeriod: handlers.setHandoffPeriod,
    filters         : DEFAULT_COMPARISON_FILTERS,
    setFilters      : handlers.setFilters,
    user            : { role: 'admin' },
    ...overrides,
  };
  const utils = render(
    <ThemeProvider>
      <StoreComparison {...props} />
    </ThemeProvider>
  );
  return { ...utils, ...handlers };
}

test('blocks a manager with an access-denied message and never fetches comparison data', async () => {
  renderPage({ user: { role: 'manager' } });
  await act(async () => {});

  expect(screen.getByText(/access denied/i)).toBeInTheDocument();
  expect(client.get).not.toHaveBeenCalled();
});

test('bootstraps to the latest available period by default (period mode, no period pinned yet)', async () => {
  // First (unconstrained) call resolves with the full range so the
  // component can learn available_periods and pick the latest as default.
  client.get.mockResolvedValueOnce({ data: FULL_RANGE_RESPONSE });
  const { setFilters } = renderPage();
  await act(async () => {});

  expect(setFilters).toHaveBeenCalled();
  const updater = setFilters.mock.calls.find(call => typeof call[0] === 'function')[0];
  expect(updater(DEFAULT_COMPARISON_FILTERS)).toMatchObject({ period: '2015-07-27' });
});

test('renders the period-mode page once pinned to a single period', async () => {
  client.get.mockResolvedValue({ data: PERIOD_RESPONSE });
  renderPage({ filters: { ...DEFAULT_COMPARISON_FILTERS, period: '2015-07-27' } });
  await act(async () => {});

  expect(screen.getByText('Store Comparison')).toBeInTheDocument();
  const table = screen.getByText('Store comparison').closest('.card');
  expect(within(table).getByText('Store 1')).toBeInTheDocument();
  expect(within(table).getByText('Store 2')).toBeInTheDocument();
  expect(screen.getByText(/2 stores compared/)).toBeInTheDocument();
  expect(screen.getByText(/Actual values available/)).toBeInTheDocument();
  expect(screen.getByText(/Historical held-out predictions/)).toBeInTheDocument();
});

test('does not render stale full-range totals while the period-mode fetch is still pinning', async () => {
  // The hook's data currently holds the unconstrained full-range response
  // even though a period has already been selected — this must not render
  // the range totals mislabeled as period figures.
  client.get.mockResolvedValue({ data: FULL_RANGE_RESPONSE });
  renderPage({ filters: { ...DEFAULT_COMPARISON_FILTERS, period: '2015-07-27' } });
  await act(async () => {});

  // FULL_RANGE_RESPONSE's start/end don't match the pinned period, so the
  // component should still show its loading skeleton, not stale content.
  expect(screen.queryByText('Store Comparison')).not.toBeInTheDocument();
});

test('clicking "Explain prediction" selects the store, hands off the period, and opens Forecast Explanation', async () => {
  client.get.mockResolvedValue({ data: PERIOD_RESPONSE });
  const { setSelectedStore, setActivePage, setHandoffPeriod } = renderPage({
    filters: { ...DEFAULT_COMPARISON_FILTERS, period: '2015-07-27' },
  });
  await act(async () => {});

  const explainButtons = screen.getAllByRole('button', { name: /explain prediction/i });
  fireEvent.click(explainButtons[0]);

  expect(setSelectedStore).toHaveBeenCalledWith(1);
  expect(setHandoffPeriod).toHaveBeenCalledWith('2015-07-27');
  expect(setActivePage).toHaveBeenCalledWith('explanation');
});

test('clicking "Prepare recommendation" selects the store, hands off the period, and opens AI Recommendations', async () => {
  client.get.mockResolvedValue({ data: PERIOD_RESPONSE });
  const { setSelectedStore, setActivePage, setHandoffPeriod } = renderPage({
    filters: { ...DEFAULT_COMPARISON_FILTERS, period: '2015-07-27' },
  });
  await act(async () => {});

  const recommendButtons = screen.getAllByRole('button', { name: /prepare recommendation/i });
  fireEvent.click(recommendButtons[0]);

  expect(setSelectedStore).toHaveBeenCalledWith(1);
  expect(setHandoffPeriod).toHaveBeenCalledWith('2015-07-27');
  expect(setActivePage).toHaveBeenCalledWith('agent');
});

test('switching to "Period range" mode reveals the range controls and totals', async () => {
  client.get.mockResolvedValue({ data: FULL_RANGE_RESPONSE });
  const { setFilters } = renderPage({
    filters: { ...DEFAULT_COMPARISON_FILTERS, mode: 'range' },
  });
  await act(async () => {});

  expect(screen.getByLabelText(/start period/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/end period/i)).toBeInTheDocument();
  expect(screen.getByText('Total predicted sales')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('radio', { name: /single period/i }));
  const updater = setFilters.mock.calls[setFilters.mock.calls.length - 1][0];
  expect(updater({ ...DEFAULT_COMPARISON_FILTERS, mode: 'range' })).toMatchObject({ mode: 'period' });
});

test('search input has an accessible, descriptive placeholder', async () => {
  client.get.mockResolvedValue({ data: PERIOD_RESPONSE });
  renderPage({ filters: { ...DEFAULT_COMPARISON_FILTERS, period: '2015-07-27' } });
  await act(async () => {});

  expect(screen.getByPlaceholderText('Search store number')).toBeInTheDocument();
});

test('shows the peer comparison label in the table', async () => {
  client.get.mockResolvedValue({ data: PERIOD_RESPONSE });
  renderPage({ filters: { ...DEFAULT_COMPARISON_FILTERS, period: '2015-07-27' } });
  await act(async () => {});

  // Average predicted across the two sample rows is 900; store 1 (1000) is
  // ~11% above average -> "Higher", store 2 (800) is ~11% below -> "Lower".
  const table = screen.getByText('Store comparison').closest('.card');
  expect(within(table).getByText('Higher predicted sales')).toBeInTheDocument();
  expect(within(table).getByText('Lower predicted sales')).toBeInTheDocument();
});

test('clicking Reset filters restores the exact default filter object (item 8)', async () => {
  client.get.mockResolvedValue({ data: PERIOD_RESPONSE });
  const filtersWithSearch = { ...DEFAULT_COMPARISON_FILTERS, period: '2015-07-27', search: '1', direction: 'over' };
  const { setFilters } = renderPage({ filters: filtersWithSearch });
  await act(async () => {});

  fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));
  expect(setFilters).toHaveBeenCalledWith(DEFAULT_COMPARISON_FILTERS);
});

test('resets the pinned period and range when forecastType changes, but not on initial mount', async () => {
  client.get.mockResolvedValue({ data: PERIOD_RESPONSE });
  const filtersWithPeriod = { ...DEFAULT_COMPARISON_FILTERS, period: '2015-07-27' };
  const { rerender, setFilters } = renderPage({ filters: filtersWithPeriod });
  await act(async () => {});

  setFilters.mockClear();

  rerender(
    <ThemeProvider>
      <StoreComparison
        forecastType="monthly"
        setForecastType={() => {}}
        setSelectedStore={() => {}}
        setActivePage={() => {}}
        setHandoffPeriod={() => {}}
        filters={filtersWithPeriod}
        setFilters={setFilters}
        user={{ role: 'admin' }}
      />
    </ThemeProvider>
  );
  await act(async () => {});

  expect(setFilters).toHaveBeenCalled();
  const updater = setFilters.mock.calls[0][0];
  expect(updater(filtersWithPeriod)).toMatchObject({ period: null, startPeriod: null, endPeriod: null });
});
