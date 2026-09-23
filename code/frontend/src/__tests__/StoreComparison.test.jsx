import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import StoreComparison, {
  DEFAULT_COMPARISON_FILTERS, classifyDirection, filterStores, countExcludedByCoverage,
  computeSummary, sortStores, rankForChart, buildComparisonCsv, formatCoverageLabel,
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

  test('is scoped to the current search — excludes stores search would already drop', () => {
    const result = countExcludedByCoverage(SAMPLE_STORES, {
      ...DEFAULT_COMPARISON_FILTERS, coverage: 'complete', search: '42',
    });
    expect(result).toBe(0); // store 2 (incomplete) doesn't match the "42" search anyway
  });
});

describe('computeSummary', () => {
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
  test('ranks by largest absolute difference by default', () => {
    const result = rankForChart(SAMPLE_STORES, 'absDifference', 10);
    expect(result.map(r => r.store_id)).toEqual([3, 42, 1, 2]);
  });

  test('limits to the requested count', () => {
    const result = rankForChart(SAMPLE_STORES, 'absDifference', 2);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.store_id)).toEqual([3, 42]);
  });

  test('ranks by highest actual sales when requested', () => {
    const result = rankForChart(SAMPLE_STORES, 'actual', 1);
    expect(result[0].store_id).toBe(42);
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

// Item 8: clearing filters (or toggling coverage and back) must restore the
// exact counts the current artifact data implies — no drift, no hardcoded
// numbers that could mask a calculation change. The absolute 1,115/5
// facts for the real artifacts are locked down in the backend test suite
// (test_store_comparison.py); this checks the dataset-agnostic invariant
// that the frontend filtering must uphold regardless of dataset size.
describe('coverage mode invariant (item 8: reset must restore correct counts)', () => {
  test('complete-coverage count plus excluded-by-coverage count equals the all-coverage count', () => {
    const completeFilters = { ...DEFAULT_COMPARISON_FILTERS, coverage: 'complete' };
    const allFilters = { ...DEFAULT_COMPARISON_FILTERS, coverage: 'all' };

    const completeCount = filterStores(SAMPLE_STORES, completeFilters).length;
    const allCount = filterStores(SAMPLE_STORES, allFilters).length;
    const excluded = countExcludedByCoverage(SAMPLE_STORES, completeFilters);

    expect(completeCount + excluded).toBe(allCount);
  });

  test('the default filters (post-reset) reproduce the same filtered set as a fresh default object', () => {
    const original = filterStores(SAMPLE_STORES, DEFAULT_COMPARISON_FILTERS).map(r => r.store_id);
    const afterReset = filterStores(SAMPLE_STORES, { ...DEFAULT_COMPARISON_FILTERS }).map(r => r.store_id);
    expect(afterReset).toEqual(original);
  });
});

describe('buildComparisonCsv', () => {
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

// ---- Render-level tests ----

const API_RESPONSE = {
  forecast_type: 'weekly',
  start_period: '2015-05-04',
  end_period: '2015-07-27',
  available_periods: ['2015-05-04', '2015-05-11', '2015-07-27'],
  selected_periods: ['2015-05-04', '2015-05-11', '2015-07-27'],
  period_count: 3,
  store_count: 2,
  stores: [
    { store_id: 1, total_predicted: 1000, total_actual: 900, difference: 100, absolute_difference: 100, difference_pct: 11.11, mae: 50, periods_covered: 3, periods_expected: 3, is_complete: true },
    { store_id: 2, total_predicted: 800, total_actual: 900, difference: -100, absolute_difference: 100, difference_pct: -11.11, mae: 40, periods_covered: 3, periods_expected: 3, is_complete: true },
  ],
};

function renderPage(overrides = {}) {
  const handlers = {
    setForecastType : jest.fn(),
    setSelectedStore: jest.fn(),
    setActivePage   : jest.fn(),
    setFilters      : jest.fn(),
  };
  const props = {
    forecastType    : 'weekly',
    setForecastType : handlers.setForecastType,
    setSelectedStore: handlers.setSelectedStore,
    setActivePage   : handlers.setActivePage,
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

test('renders the page for an admin with mocked data', async () => {
  client.get.mockResolvedValue({ data: API_RESPONSE });
  renderPage();
  await act(async () => {});

  expect(screen.getByText('Store Comparison')).toBeInTheDocument();
  expect(screen.getByText('Store 1')).toBeInTheDocument();
  expect(screen.getByText('Store 2')).toBeInTheDocument();
});

test('clicking "View forecast" selects that store and switches to the Forecast page', async () => {
  client.get.mockResolvedValue({ data: API_RESPONSE });
  const { setSelectedStore, setActivePage } = renderPage();
  await act(async () => {});

  const viewButtons = screen.getAllByRole('button', { name: /view forecast/i });
  fireEvent.click(viewButtons[0]);

  expect(setSelectedStore).toHaveBeenCalledWith(1);
  expect(setActivePage).toHaveBeenCalledWith('forecast');
});

test('resets the period range when forecastType changes, but not on initial mount', async () => {
  client.get.mockResolvedValue({ data: API_RESPONSE });
  const filtersWithRange = { ...DEFAULT_COMPARISON_FILTERS, startPeriod: '2015-05-04', endPeriod: '2015-05-11' };
  const { rerender, setFilters } = renderPage({ filters: filtersWithRange });
  await act(async () => {});

  expect(setFilters).not.toHaveBeenCalled();

  rerender(
    <ThemeProvider>
      <StoreComparison
        forecastType="monthly"
        setForecastType={() => {}}
        setSelectedStore={() => {}}
        setActivePage={() => {}}
        filters={filtersWithRange}
        setFilters={setFilters}
        user={{ role: 'admin' }}
      />
    </ThemeProvider>
  );
  await act(async () => {});

  expect(setFilters).toHaveBeenCalled();
  const updater = setFilters.mock.calls[0][0];
  expect(updater(filtersWithRange)).toMatchObject({ startPeriod: null, endPeriod: null });
});

test('search input has an accessible, descriptive placeholder', async () => {
  client.get.mockResolvedValue({ data: API_RESPONSE });
  renderPage();
  await act(async () => {});

  expect(screen.getByPlaceholderText('Search store number')).toBeInTheDocument();
});

test('an active search shows a removable filter chip and the dynamic match count', async () => {
  client.get.mockResolvedValue({ data: API_RESPONSE });
  const filtersWithSearch = { ...DEFAULT_COMPARISON_FILTERS, search: '1' };
  renderPage({ filters: filtersWithSearch });
  await act(async () => {});

  expect(screen.getByText('Store contains "1"')).toBeInTheDocument();
  // API_RESPONSE has stores 1 and 2; only "1" matches the substring search.
  expect(screen.getByText(/1 of 2 stores match filters/)).toBeInTheDocument();
});

test('removing the search chip clears the search filter', async () => {
  client.get.mockResolvedValue({ data: API_RESPONSE });
  const filtersWithSearch = { ...DEFAULT_COMPARISON_FILTERS, search: '1' };
  const { setFilters } = renderPage({ filters: filtersWithSearch });
  await act(async () => {});

  fireEvent.click(screen.getByRole('button', { name: /remove filter: store contains "1"/i }));
  const updater = setFilters.mock.calls[setFilters.mock.calls.length - 1][0];
  expect(updater(filtersWithSearch)).toMatchObject({ search: '' });
});

test('the clear-search button empties the search field', async () => {
  client.get.mockResolvedValue({ data: API_RESPONSE });
  const filtersWithSearch = { ...DEFAULT_COMPARISON_FILTERS, search: '1' };
  const { setFilters } = renderPage({ filters: filtersWithSearch });
  await act(async () => {});

  fireEvent.click(screen.getByRole('button', { name: /^clear search$/i }));
  const updater = setFilters.mock.calls[setFilters.mock.calls.length - 1][0];
  expect(updater(filtersWithSearch)).toMatchObject({ search: '' });
});

test('shows "No filters applied" and a full match count when no filters are active', async () => {
  client.get.mockResolvedValue({ data: API_RESPONSE });
  renderPage();
  await act(async () => {});

  expect(screen.getByText('No filters applied')).toBeInTheDocument();
  expect(screen.getByText(/2 of 2 stores match filters/)).toBeInTheDocument();
});

test('overprediction/underprediction badges use neutral styling, not the chart\'s indigo/orange series colours', async () => {
  client.get.mockResolvedValue({ data: API_RESPONSE });
  renderPage();
  await act(async () => {});

  // "Overprediction"/"Underprediction" also appear as <option> labels in the
  // Direction filter select — scope to the table's badge <span> specifically.
  const overBadge = screen.getByText('Overprediction', { selector: 'span' });
  const underBadge = screen.getByText('Underprediction', { selector: 'span' });
  expect(overBadge.className).not.toMatch(/indigo/);
  expect(overBadge.className).not.toMatch(/orange/);
  expect(underBadge.className).not.toMatch(/indigo/);
  expect(underBadge.className).not.toMatch(/orange/);
});

test('clicking Reset filters restores the exact default filter object (item 8)', async () => {
  client.get.mockResolvedValue({ data: API_RESPONSE });
  const filtersWithSearch = { ...DEFAULT_COMPARISON_FILTERS, search: '1', direction: 'over', coverage: 'all' };
  const { setFilters } = renderPage({ filters: filtersWithSearch });
  await act(async () => {});

  fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));
  expect(setFilters).toHaveBeenCalledWith(DEFAULT_COMPARISON_FILTERS);
});
