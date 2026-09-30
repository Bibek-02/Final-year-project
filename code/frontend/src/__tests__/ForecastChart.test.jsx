import React from 'react';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ForecastChart, {
  pickEvenIndices, formatFullDate, formatWeeklyPeriod, formatMonthlyPeriod,
  classifyResult, niceDomain, focusedDomain, describePeriodChange, buildCsv,
} from '../pages/forecast/ForecastChart';
import { ThemeProvider } from '../context/ThemeContext';
import client from '../api/client';

// Same automock approach as the rest of this project's tests (see
// Login.test.jsx / Dashboard.test.jsx for why an inline mock factory can't
// be used here — an inline jest.fn() implementation silently drops under
// this Jest version).
jest.mock('../api/client');

const WEEKLY_FORECASTS = [
  { period: '2015-05-04', actual_sales: 19500, prediction: 20000 },
  { period: '2015-05-11', actual_sales: 21800, prediction: 22000 },
  { period: '2015-05-18', actual_sales: 20900, prediction: 21000 },
];

const MONTHLY_FORECASTS = [
  { period: '2015-05-01', actual_sales: 80000, prediction: 82000 },
  { period: '2015-06-01', actual_sales: 91000, prediction: 89000 },
  { period: '2015-07-01', actual_sales: 87000, prediction: 88000 },
];

// One row has zero actual sales — must be excluded from MAPE (but not MAE)
// and must never render NaN/Infinity anywhere on the page.
const ZERO_ACTUAL_FORECASTS = [
  { period: '2015-05-04', actual_sales: 0, prediction: 20000 },
  { period: '2015-05-11', actual_sales: 21800, prediction: 22000 },
  { period: '2015-05-18', actual_sales: 20900, prediction: 21000 },
];

// One row has no recorded sales at all — must read "Unavailable", distinct
// from the zero-actual case above, and must be excluded from MAE and MAPE.
const MISSING_ACTUAL_FORECASTS = [
  { period: '2015-05-04', actual_sales: null, prediction: 20000 },
  { period: '2015-05-11', actual_sales: 21800, prediction: 22000 },
  { period: '2015-05-18', actual_sales: 20900, prediction: 21000 },
];

function mockHappyPath({ forecasts = WEEKLY_FORECASTS } = {}) {
  client.get.mockImplementation((url) => {
    if (url.startsWith('/forecast/')) return Promise.resolve({ data: { forecasts } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

async function renderForecastChart(props = {}) {
  const utils = render(
    <ThemeProvider>
      <ForecastChart selectedStore={1} forecastType="weekly" {...props} />
    </ThemeProvider>
  );
  await act(async () => {});
  return utils;
}

// Scopes a KPI's displayed value to its own card, avoiding collisions with
// identical numbers rendered elsewhere (chart labels, table cells).
function kpiValue(label) {
  const card = screen.getByText(label).closest('.metric-card');
  return card.querySelector('.kpi-value, .text-lg.font-bold');
}

// The period navigator's own accessible group — scoping to it avoids
// collisions with identical short-date strings that can legitimately also
// appear as a KPI sublabel (e.g. the Highest/Lowest prediction period).
function navigatorGroup() {
  return screen.getByRole('group', { name: /step through forecast periods/i });
}

// JSDOM doesn't apply real CSS (Tailwind's "hidden"/"sm:block" responsive
// classes have no effect), so the desktop table and the mobile period cards
// both render at once in tests — scope to the table for anything that also
// appears on the mobile cards.
function breakdownTable() {
  return screen.getByRole('table');
}

function actualSalesSwitch() {
  return screen.getByRole('switch', { name: /actual sales/i });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---- Pure formatter/derivation unit tests ----

describe('pickEvenIndices', () => {
  test('picks exactly 4 evenly-spaced indices for 13 items, including first and last', () => {
    expect(pickEvenIndices(13, 4)).toEqual(new Set([0, 4, 8, 12]));
  });

  test('returns every index when there are already fewer items than the target count', () => {
    expect(pickEvenIndices(3, 4)).toEqual(new Set([0, 1, 2]));
  });
});

describe('date/period formatters', () => {
  test('formats a full date as "4 May 2015"', () => {
    expect(formatFullDate('2015-05-04')).toBe('4 May 2015');
  });

  test('formats a weekly period as "Week beginning 4 May 2015"', () => {
    expect(formatWeeklyPeriod('2015-05-04')).toBe('Week beginning 4 May 2015');
  });

  test('formats a monthly period as "May 2015"', () => {
    expect(formatMonthlyPeriod('2015-05-01')).toBe('May 2015');
  });
});

describe('niceDomain (zero-based / "Start at zero" mode)', () => {
  test('is always zero-based with ~10% headroom rounded to a nice ceiling', () => {
    expect(niceDomain([21000])).toEqual([0, 40000]);
  });

  test('handles an empty/degenerate input safely', () => {
    expect(niceDomain([])).toEqual([0, 1]);
  });
});

describe('focusedDomain (default, data-driven Y-axis mode)', () => {
  test('pads the observed range ~10% and rounds both ends to a shared nice step', () => {
    expect(focusedDomain([19500, 20000, 21800, 22000, 20900, 21000])).toEqual([19000, 23000]);
  });

  test('a constant series has no range to focus on, so it defers to the zero-based domain', () => {
    expect(focusedDomain([20000, 20000, 20000])).toEqual(niceDomain([20000, 20000, 20000]));
  });

  test('an all-zero series defers to the zero-based domain rather than an invalid range', () => {
    expect(focusedDomain([0, 0, 0])).toEqual([0, 1]);
  });
});

describe('classifyResult (factual, threshold-free direction)', () => {
  test('a prediction above actual is "Above actual", even by a tiny margin', () => {
    expect(classifyResult(10100, 10000)).toBe('Above actual');
  });

  test('a prediction below actual is "Below actual"', () => {
    expect(classifyResult(9000, 10000)).toBe('Below actual');
  });

  test('an exact match is "Matches actual"', () => {
    expect(classifyResult(10000, 10000)).toBe('Matches actual');
  });

  test('is computed from original values, not rounded display values', () => {
    // 10000.4 rounds to 10000 for display but is still genuinely above 10000.
    expect(classifyResult(10000.4, 10000)).toBe('Above actual');
  });
});

describe('describePeriodChange', () => {
  test('reports no previous prediction honestly for the first period (not "0%")', () => {
    const result = describePeriodChange({ prediction: 20000 }, null);
    expect(result.state).toBe('no-previous');
    expect(result.text).toBe('No previous prediction');
  });

  test('reports "Not calculable" — not "0%" — when the previous prediction was exactly zero', () => {
    const result = describePeriodChange({ prediction: 20000 }, { prediction: 0 });
    expect(result.state).toBe('zero-previous');
    expect(result.text).toBe('Not calculable');
  });

  test('computes a normal positive percentage change with a leading +', () => {
    const result = describePeriodChange({ prediction: 22000 }, { prediction: 20000 });
    expect(result.text).toBe('+10.0%');
    expect(result.direction).toBe('up');
  });

  test('computes a negative percentage change with a real minus sign, not an ASCII hyphen', () => {
    const result = describePeriodChange({ prediction: 21000 }, { prediction: 22000 });
    expect(result.text).toBe('−4.5%');
    expect(result.text).not.toContain('-4.5');
  });
});

describe('buildCsv', () => {
  test('prediction-only CSV includes the change-from-previous column', () => {
    const csv = buildCsv(WEEKLY_FORECASTS, 'weekly', false);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Period,Predicted Sales,Change From Previous Prediction');
    expect(lines[1]).toContain('No previous prediction');
    expect(lines[2]).toContain('+10.0%'); // 22000 vs 20000
  });

  test('comparison CSV computes difference/percentage/direction from original values', () => {
    const csv = buildCsv(WEEKLY_FORECASTS, 'weekly', true);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Period,Predicted Sales,Actual Sales,Predicted Minus Actual,Absolute Percentage Error,Direction');
    // Row 1: predicted 20000, actual 19500 -> diff +500, ape 2.6%, Above actual
    expect(lines[1]).toContain('+500');
    expect(lines[1]).toContain('Above actual');
  });

  test('a zero-actual row gets an Undefined percentage error but a valid difference', () => {
    const csv = buildCsv(ZERO_ACTUAL_FORECASTS, 'weekly', true);
    const firstRow = csv.split('\n')[1];
    expect(firstRow).toContain('+20000'); // predicted - 0
    expect(firstRow).toContain('Undefined');
  });

  test('a missing-actual row leaves numeric cells blank rather than zero', () => {
    const csv = buildCsv(MISSING_ACTUAL_FORECASTS, 'weekly', true);
    const firstRow = csv.split('\n')[1].split(',');
    expect(firstRow[2]).toBe(''); // Actual Sales
    expect(firstRow[3]).toBe(''); // Predicted Minus Actual
    expect(firstRow[5]).toBe('Unavailable'); // Direction
  });
});

// ---- Integration tests ----

test('forecast-only mode is the default', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(actualSalesSwitch()).toHaveAttribute('aria-checked', 'false');
});

test('actual sales values are not visible before comparison is enabled', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.queryByText('19,500')).not.toBeInTheDocument();
  // The switch's own label is always "Actual sales" (a stable label whose
  // checked state communicates visibility) — the legend line is the thing
  // that should not appear yet.
  expect(screen.queryByText('Total actual sales')).not.toBeInTheDocument();
});

test('forecast-only KPI cards show real values, not dashes, with no "success" styling on the highest prediction', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.getByText('Total predicted sales')).toBeInTheDocument();
  expect(screen.getByText('Average prediction')).toBeInTheDocument();
  expect(screen.getByText('Highest prediction')).toBeInTheDocument();
  expect(screen.getByText('Lowest prediction')).toBeInTheDocument();
  expect(kpiValue('Total predicted sales')).toHaveTextContent('63,000');

  const highestValue = kpiValue('Highest prediction');
  expect(highestValue.className).not.toMatch(/semantic-success|green-400/);
});

test('weekly count and date range are calculated dynamically, not hard-coded', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.getByText(/Historical test predictions · Weekly · 4 May–18 May 2015 · 3 periods/)).toBeInTheDocument();
});

test('monthly count and date range are calculated dynamically', async () => {
  mockHappyPath({ forecasts: MONTHLY_FORECASTS });
  await renderForecastChart({ forecastType: 'monthly' });

  expect(screen.getByText(/Historical test predictions · Monthly · May–July 2015 · 3 periods/)).toBeInTheDocument();
});

test('the comparison switch keeps a stable "Actual sales" label and reveals actual sales values', async () => {
  mockHappyPath();
  await renderForecastChart();

  const toggle = actualSalesSwitch();
  expect(toggle).toHaveTextContent('Actual sales');

  await act(async () => {
    fireEvent.click(toggle);
  });

  expect(actualSalesSwitch()).toHaveAttribute('aria-checked', 'true');
  expect(actualSalesSwitch()).toHaveTextContent('Actual sales'); // label text itself never changes
  expect(within(breakdownTable()).getByText('19,500')).toBeInTheDocument();
});

test('the comparison switch updates the KPI definitions to the renamed error metrics', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(actualSalesSwitch());
  });

  expect(screen.getByText('Total actual sales')).toBeInTheDocument();
  expect(screen.getByText('Average absolute error')).toBeInTheDocument();
  expect(screen.getByText('Average absolute percentage error')).toBeInTheDocument();
  expect(screen.queryByText('Average prediction')).not.toBeInTheDocument();
  expect(screen.queryByText('Highest prediction')).not.toBeInTheDocument();
});

test('average absolute error is calculated correctly', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(actualSalesSwitch());
  });

  // |19500-20000| + |21800-22000| + |20900-21000| = 500+200+100 = 800 / 3 = 266.67 -> 267
  expect(kpiValue('Average absolute error')).toHaveTextContent('267');
});

test('average absolute percentage error excludes rows with zero actual sales', async () => {
  mockHappyPath({ forecasts: ZERO_ACTUAL_FORECASTS });
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(actualSalesSwitch());
  });

  // Only the two non-zero rows count: (200/21800 + 100/20900) / 2 * 100 ≈ 0.7%
  expect(kpiValue('Average absolute percentage error')).toHaveTextContent('0.7%');
});

test('a zero actual-sales row is handled safely, without NaN or Infinity anywhere', async () => {
  mockHappyPath({ forecasts: ZERO_ACTUAL_FORECASTS });
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(actualSalesSwitch());
  });

  expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
  expect(within(breakdownTable()).getByText('Undefined — zero actual')).toBeInTheDocument();
});

test('a missing actual-sales row reads "Unavailable", distinct from a zero actual value', async () => {
  mockHappyPath({ forecasts: MISSING_ACTUAL_FORECASTS });
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(actualSalesSwitch());
  });

  const row = within(breakdownTable()).getByText('4 May 2015').closest('tr');
  // Actual sales, difference, error and direction are all "Unavailable" for
  // this row since it has no recorded sales at all.
  expect(within(row).getAllByText('Unavailable').length).toBeGreaterThan(0);
  // The coverage disclosure appears since one of three periods is missing.
  expect(screen.getByText(/unavailable for 1 of 3 periods/)).toBeInTheDocument();
});

test('the chart legend changes with comparison mode', async () => {
  mockHappyPath();
  await renderForecastChart();

  // Only the switch itself reads "Actual sales" before comparison is on.
  expect(screen.queryAllByText('Actual sales')).toHaveLength(1);

  await act(async () => {
    fireEvent.click(actualSalesSwitch());
  });

  // The legend now adds a second "Actual sales" entry alongside the switch.
  expect(screen.queryAllByText('Actual sales').length).toBeGreaterThan(1);
});

test('selecting a period updates the shared selection state that both the chart and the table read', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); }); // -> 11 May

  expect(within(navigatorGroup()).getByText(/11 May 2015/)).toBeInTheDocument();
  const row = within(breakdownTable()).getByText('11 May 2015').closest('tr');
  expect(row).toHaveAttribute('aria-selected', 'true');
});

test('selecting a table row updates the selected period', async () => {
  mockHappyPath();
  await renderForecastChart();

  const row = within(breakdownTable()).getByText('11 May 2015').closest('tr');
  await act(async () => {
    fireEvent.click(row);
  });

  expect(row).toHaveAttribute('aria-selected', 'true');
  expect(within(navigatorGroup()).getByText(/11 May 2015/)).toBeInTheDocument();
});

test('Previous and Next controls step through periods correctly', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(within(navigatorGroup()).getByText(/18 May 2015/)).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); });
  expect(within(navigatorGroup()).getByText(/11 May 2015/)).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next period' })); });
  expect(within(navigatorGroup()).getByText(/18 May 2015/)).toBeInTheDocument();
});

test('boundary Previous/Next buttons are disabled at the first and last period', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); });

  expect(within(navigatorGroup()).getByText(/4 May 2015/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous period' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next period' })).toBeEnabled();
});

test('forecast-only table columns are correct, with no separate Trend column', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.getByRole('columnheader', { name: 'Predicted sales' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Change from previous prediction' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Trend' })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Actual' })).not.toBeInTheDocument();
});

test('comparison table columns use factual Direction labels, not "Result"', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(actualSalesSwitch());
  });

  expect(screen.getByRole('columnheader', { name: /Predicted sales/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Actual sales/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Predicted . actual/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Absolute % error/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Direction/ })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: /^Result$/ })).not.toBeInTheDocument();

  // A prediction meaningfully above actual (within what used to be the 2%
  // "close forecast" threshold) is now factually "Above actual", not
  // "Close forecast".
  const row = within(breakdownTable()).getByText('4 May 2015').closest('tr');
  expect(within(row).getByText('Above actual')).toBeInTheDocument();
});

test('shows an empty state when the store has no forecasts, instead of crashing', async () => {
  mockHappyPath({ forecasts: [] });
  await renderForecastChart();

  expect(screen.getByText('No forecasts for this store')).toBeInTheDocument();
});

test('shows an error banner with a working retry on API failure', async () => {
  client.get.mockRejectedValue(new Error('network down'));
  await renderForecastChart();

  expect(screen.getByRole('alert')).toBeInTheDocument();
  const callsBefore = client.get.mock.calls.length;

  mockHappyPath();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  });

  expect(client.get.mock.calls.length).toBeGreaterThan(callsBefore);
  expect(await screen.findByText('Total predicted sales')).toBeInTheDocument();
});

test('rapid store changes do not show stale data from the previous store', async () => {
  client.get.mockImplementation((url) => {
    if (url.startsWith('/forecast/7')) return Promise.resolve({ data: { forecasts: MONTHLY_FORECASTS } });
    if (url.startsWith('/forecast/1')) return Promise.resolve({ data: { forecasts: WEEKLY_FORECASTS } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  const { rerender } = await renderForecastChart({ selectedStore: 1 });

  expect(client.get).toHaveBeenCalledWith(expect.stringContaining('/forecast/1'));
  expect(screen.getByText('63,000')).toBeInTheDocument(); // store 1 total predicted

  await act(async () => {
    rerender(
      <ThemeProvider>
        <ForecastChart selectedStore={7} forecastType="weekly" />
      </ThemeProvider>
    );
  });

  expect(client.get).toHaveBeenCalledWith(expect.stringContaining('/forecast/7'));
  expect(screen.getByText('259,000')).toBeInTheDocument(); // store 7 total predicted
  expect(screen.queryByText('63,000')).not.toBeInTheDocument();
});

test('a store change resets a stale period selection back to the latest period', async () => {
  client.get.mockImplementation((url) => {
    if (url.startsWith('/forecast/7')) return Promise.resolve({ data: { forecasts: MONTHLY_FORECASTS } });
    if (url.startsWith('/forecast/1')) return Promise.resolve({ data: { forecasts: WEEKLY_FORECASTS } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  const { rerender } = await renderForecastChart({ selectedStore: 1 });

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); }); // -> 11 May
  expect(within(navigatorGroup()).getByText(/11 May 2015/)).toBeInTheDocument();

  await act(async () => {
    rerender(
      <ThemeProvider>
        <ForecastChart selectedStore={7} forecastType="monthly" />
      </ThemeProvider>
    );
  });

  // New context: falls back to the latest period of the new store/type, not
  // a coincidentally-matching or now-nonexistent period from the old one.
  expect(within(navigatorGroup()).getByText(/Jul 2015/)).toBeInTheDocument();
});

test('actual sales are never sent to another API from this page', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(actualSalesSwitch());
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
  });

  expect(client.post).not.toHaveBeenCalled();
});

test('mobile tick sampling preserves the first and final periods', () => {
  // 13 weekly points, sampled down to 4 mobile ticks.
  const picks = pickEvenIndices(13, 4);
  expect(picks.has(0)).toBe(true);
  expect(picks.has(12)).toBe(true);
  expect(picks.size).toBe(4);
});

test('"Start at zero" is a secondary control that toggles the Y-axis mode', async () => {
  mockHappyPath();
  await renderForecastChart();

  const zeroButton = screen.getByRole('button', { name: 'Start at zero' });
  await act(async () => { fireEvent.click(zeroButton); });

  expect(screen.getByRole('button', { name: 'Show focused range' })).toBeInTheDocument();
});

// ---- Selected-period details + "Explain this prediction" handoff ----

test('the selected-period panel shows predicted sales and change from previous prediction', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.getByText('Selected period')).toBeInTheDocument();
  // Appears as both the table's column header and the panel's own <dt> —
  // assert at least the panel's occurrence exists rather than requiring
  // uniqueness across the whole page.
  expect(screen.getAllByText('Change from previous prediction').length).toBeGreaterThan(0);
});

test('"Explain this prediction" hands off the selected period and navigates to Explanation', async () => {
  mockHappyPath();
  const setActivePage = jest.fn();
  const setHandoffPeriod = jest.fn();
  await renderForecastChart({ setActivePage, setHandoffPeriod });

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); }); // -> 11 May
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Explain this prediction →' }));
  });

  expect(setHandoffPeriod).toHaveBeenCalledWith('2015-05-11');
  expect(setActivePage).toHaveBeenCalledWith('explanation');
});

test('"Explain this prediction" is not rendered when no page-navigation callback is provided', async () => {
  mockHappyPath();
  await renderForecastChart({ setActivePage: undefined });

  expect(screen.queryByRole('button', { name: /Explain this prediction/ })).not.toBeInTheDocument();
});

// ---- Period handoff (e.g. from Dashboard's "View full forecast") ----

test('a handed-off period seeds the selected period immediately, and is consumed once and cleared', async () => {
  mockHappyPath();
  const setHandoffPeriod = jest.fn();
  await renderForecastChart({ handoffPeriod: '2015-05-11', setHandoffPeriod });

  // Seeded directly at mount — no Previous/Next click needed.
  expect(within(navigatorGroup()).getByText(/11 May 2015/)).toBeInTheDocument();
  const row = within(breakdownTable()).getByText('11 May 2015').closest('tr');
  expect(row).toHaveAttribute('aria-selected', 'true');

  expect(setHandoffPeriod).toHaveBeenCalledWith(null);
  expect(setHandoffPeriod).toHaveBeenCalledTimes(1);
});

test('with no handed-off period, the clear callback is never invoked and the latest period is selected as before', async () => {
  mockHappyPath();
  const setHandoffPeriod = jest.fn();
  await renderForecastChart({ setHandoffPeriod });

  expect(within(navigatorGroup()).getByText(/18 May 2015/)).toBeInTheDocument();
  expect(setHandoffPeriod).not.toHaveBeenCalled();
});

test('a handed-off period unavailable in this store/forecast type honestly discloses the fallback', async () => {
  mockHappyPath();
  await renderForecastChart({ handoffPeriod: '1999-01-01' });

  expect(within(navigatorGroup()).getByText(/18 May 2015/)).toBeInTheDocument(); // falls back to latest
  expect(screen.getByText(/requested period isn't available/i)).toBeInTheDocument();
});

// ---- Refinement pass: table wrapping, spacing, hover/selection clarity,
// contextual scope wording, and the collapsed-by-default About section ----

test('weekly table uses a "Week beginning" column heading with compact per-row dates', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.getByRole('columnheader', { name: 'Week beginning' })).toBeInTheDocument();
  // Compact date, not the long "Week beginning 11 May 2015" form that wrapped.
  const row = within(breakdownTable()).getByText('11 May 2015').closest('tr');
  expect(row).toBeInTheDocument();
  expect(within(breakdownTable()).queryByText('Week beginning 11 May 2015')).not.toBeInTheDocument();
});

test('monthly table uses a "Month" column heading with a full month name', async () => {
  mockHappyPath({ forecasts: MONTHLY_FORECASTS });
  await renderForecastChart({ forecastType: 'monthly' });

  expect(screen.getByRole('columnheader', { name: 'Month' })).toBeInTheDocument();
  expect(within(breakdownTable()).getByText('June 2015')).toBeInTheDocument();
});

test('direction badges do not wrap onto a second line', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(actualSalesSwitch());
  });

  const badges = within(breakdownTable()).getAllByText('Above actual');
  expect(badges.length).toBeGreaterThan(0);
  badges.forEach(badge => expect(badge.className).toMatch(/whitespace-nowrap/));
});

test('the navigator explicitly labels the current selection', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(within(navigatorGroup()).getByText(/Selected:\s*18 May 2015/)).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); });
  expect(within(navigatorGroup()).getByText(/Selected:\s*11 May 2015/)).toBeInTheDocument();
});

test('the selected-period panel groups prediction-error and change-from-previous figures separately', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(actualSalesSwitch());
  });

  expect(screen.getByText('Compared with recorded sales')).toBeInTheDocument();
  expect(screen.getByText('Compared with the previous prediction')).toBeInTheDocument();
});

test('the summary scope line is contextual and data-driven in prediction-only mode', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.getByText('Summary for Store 1 across 3 displayed weeks.')).toBeInTheDocument();
  expect(screen.queryByText(/overall performance/)).not.toBeInTheDocument();
});

test('the summary scope line explains the error metrics scope in comparison mode', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(actualSalesSwitch());
  });

  expect(screen.getByText(/Error metrics reflect Store 1's 3 displayed weeks of comparison\./)).toBeInTheDocument();
});

test('the summary scope line does not hard-code a period count across forecast types', async () => {
  mockHappyPath({ forecasts: MONTHLY_FORECASTS });
  await renderForecastChart({ forecastType: 'monthly' });

  expect(screen.getByText('Summary for Store 1 across 3 displayed months.')).toBeInTheDocument();
});

test('"About this analysis" starts collapsed and expands via its own toggle button', async () => {
  mockHappyPath();
  await renderForecastChart();

  const toggle = screen.getByRole('button', { name: /about this analysis/i });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText(/Average absolute error \(MAE\)/)).not.toBeInTheDocument();

  await act(async () => { fireEvent.click(toggle); });

  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/Average absolute error \(MAE\)/)).toBeInTheDocument();
  // Runtime implementation detail removed from the main explanatory paragraph.
  expect(screen.queryByText(/SHAP values are recalculated/)).not.toBeInTheDocument();
  expect(screen.getByText(/See Model Comparison for the model's evaluation metrics/)).toBeInTheDocument();
});

test('hovering the chart does not change the period sent to "Explain this prediction"', async () => {
  // The chart's Tooltip/activeDot only previews on hover — there is no code
  // path from Recharts' mouse-move handling into setSelectedPeriod, so the
  // period handed to Explanation can only change via an explicit selection
  // (Previous/Next, a table row, or a chart-dot click). This asserts that
  // invariant holds after a selection is made, without relying on JSDOM
  // being able to simulate a real Recharts hover (it cannot, since
  // ResponsiveContainer never measures a non-zero size in JSDOM).
  mockHappyPath();
  const setActivePage = jest.fn();
  const setHandoffPeriod = jest.fn();
  await renderForecastChart({ setActivePage, setHandoffPeriod });

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); }); // -> 11 May
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Explain this prediction →' }));
  });

  expect(setHandoffPeriod).toHaveBeenCalledWith('2015-05-11');
  expect(setHandoffPeriod).not.toHaveBeenCalledWith('2015-05-18');
});
