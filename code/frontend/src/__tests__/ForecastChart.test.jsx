import React from 'react';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ForecastChart, {
  pickEvenIndices, formatFullDate, formatWeeklyPeriod, formatMonthlyPeriod,
  classifyResult, classifyTrend,
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
// appear as a KPI sublabel (e.g. the Highest/Lowest forecast period).
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

describe('classifyResult', () => {
  test('within the 2% threshold is a Close forecast', () => {
    expect(classifyResult(10100, 10000)).toBe('Close forecast'); // 1% over
  });

  test('predicted meaningfully higher than actual is an Over forecast', () => {
    expect(classifyResult(10500, 10000)).toBe('Over forecast'); // 5% over
  });

  test('predicted meaningfully lower than actual is an Under forecast', () => {
    expect(classifyResult(9000, 10000)).toBe('Under forecast'); // 10% under
  });
});

describe('classifyTrend', () => {
  test('a sub-1% change is treated as no material change', () => {
    expect(classifyTrend(0.5)).toBe('No material change');
  });

  test('a positive change above the threshold is an Increase', () => {
    expect(classifyTrend(5)).toBe('Increase');
  });

  test('a negative change above the threshold is a Decrease', () => {
    expect(classifyTrend(-5)).toBe('Decrease');
  });
});

// ---- Integration tests ----

test('forecast-only mode is the default, with no "Historical evaluation" badge', async () => {
  mockHappyPath();
  await renderForecastChart();

  const toggle = screen.getByRole('switch', { name: /show actual sales/i });
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(screen.queryByText('Historical evaluation')).not.toBeInTheDocument();
});

test('actual sales values are not visible before comparison is enabled', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.queryByText('19,500')).not.toBeInTheDocument();
  expect(screen.queryByText('Actual sales')).not.toBeInTheDocument();
});

test('forecast-only KPI cards show real values, not dashes', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.getByText('Total predicted sales')).toBeInTheDocument();
  expect(screen.getByText('Average prediction')).toBeInTheDocument();
  expect(screen.getByText('Highest forecast')).toBeInTheDocument();
  expect(screen.getByText('Lowest forecast')).toBeInTheDocument();
  expect(screen.queryByText('—')).not.toBeInTheDocument();
  expect(screen.queryByText('Reveal to view')).not.toBeInTheDocument();
  expect(kpiValue('Total predicted sales')).toHaveTextContent('63,000');
});

test('weekly count and date range are calculated dynamically, not hard-coded', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.getByText(/Explore 3 precomputed weekly predictions/)).toBeInTheDocument();
  expect(screen.getByText('4 May–18 May 2015')).toBeInTheDocument();
});

test('monthly count and date range are calculated dynamically', async () => {
  mockHappyPath({ forecasts: MONTHLY_FORECASTS });
  await renderForecastChart({ forecastType: 'monthly' });

  expect(screen.getByText(/Explore 3 precomputed monthly predictions/)).toBeInTheDocument();
  expect(screen.getByText('May–July 2015')).toBeInTheDocument();
});

test('the comparison switch reveals actual sales values', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: /show actual sales/i }));
  });

  expect(screen.getByRole('switch', { name: /hide actual sales/i })).toHaveAttribute('aria-checked', 'true');
  expect(within(breakdownTable()).getByText('19,500')).toBeInTheDocument();
  expect(screen.getByText('Historical evaluation')).toBeInTheDocument();
});

test('the comparison switch updates the KPI definitions', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: /show actual sales/i }));
  });

  expect(screen.getByText('Total actual sales')).toBeInTheDocument();
  expect(screen.getByText('Displayed-period MAE')).toBeInTheDocument();
  expect(screen.getByText('Displayed-period MAPE')).toBeInTheDocument();
  expect(screen.queryByText('Average prediction')).not.toBeInTheDocument();
  expect(screen.queryByText('Highest forecast')).not.toBeInTheDocument();
});

test('displayed-period MAE is calculated correctly', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: /show actual sales/i }));
  });

  // |19500-20000| + |21800-22000| + |20900-21000| = 500+200+100 = 800 / 3 = 266.67 -> 267
  expect(kpiValue('Displayed-period MAE')).toHaveTextContent('267');
});

test('displayed-period MAPE excludes rows with zero actual sales', async () => {
  mockHappyPath({ forecasts: ZERO_ACTUAL_FORECASTS });
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: /show actual sales/i }));
  });

  // Only the two non-zero rows count: (200/21800 + 100/20900) / 2 * 100 ≈ 0.7%
  expect(kpiValue('Displayed-period MAPE')).toHaveTextContent('0.7%');
});

test('a zero actual-sales row is handled safely, without NaN or Infinity anywhere', async () => {
  mockHappyPath({ forecasts: ZERO_ACTUAL_FORECASTS });
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: /show actual sales/i }));
  });

  expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
  expect(within(breakdownTable()).getByText('N/A — zero actual sales')).toBeInTheDocument();
});

test('the chart legend changes with comparison mode', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.queryByText('Actual sales')).not.toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: /show actual sales/i }));
  });

  expect(screen.getByText('Actual sales')).toBeInTheDocument();
});

// Recharts' ResponsiveContainer only renders its SVG children once it has a
// real measured size, which JSDOM (no layout engine) never provides — so a
// chart point's dot never mounts in this test environment. Dashboard.test.jsx
// hits the same limitation and works around it the same way: the chart's dot
// onClick calls the exact same setSelectedPeriod(period) the navigator's
// buttons call, so exercising that shared path and checking it stays synced
// with the table (whose row highlighting is driven by the same state the
// chart's selected-dot highlighting reads) covers the same behaviour.
test('selecting a period updates the shared selection state that both the chart and the table read', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); }); // -> 11 May

  expect(within(navigatorGroup()).getByText('11 May 2015')).toBeInTheDocument();
  const row = within(breakdownTable()).getByText('Week beginning 11 May 2015').closest('tr');
  expect(row).toHaveAttribute('aria-selected', 'true');
});

test('selecting a table row updates the selected period', async () => {
  mockHappyPath();
  await renderForecastChart();

  const row = within(breakdownTable()).getByText('Week beginning 11 May 2015').closest('tr');
  await act(async () => {
    fireEvent.click(row);
  });

  expect(row).toHaveAttribute('aria-selected', 'true');
  expect(within(navigatorGroup()).getByText('11 May 2015')).toBeInTheDocument();
});

test('Previous and Next controls step through periods correctly', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(within(navigatorGroup()).getByText('18 May 2015')).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); });
  expect(within(navigatorGroup()).getByText('11 May 2015')).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next period' })); });
  expect(within(navigatorGroup()).getByText('18 May 2015')).toBeInTheDocument();
});

test('boundary Previous/Next buttons are disabled at the first and last period', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); });

  expect(within(navigatorGroup()).getByText('4 May 2015')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous period' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next period' })).toBeEnabled();
});

test('forecast-only table columns are correct', async () => {
  mockHappyPath();
  await renderForecastChart();

  expect(screen.getByRole('columnheader', { name: 'Predicted sales' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Change from previous' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Trend' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Actual' })).not.toBeInTheDocument();
});

test('comparison table columns are correct', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: /show actual sales/i }));
  });

  expect(screen.getByRole('columnheader', { name: 'Predicted' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Actual' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Difference' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Absolute % error' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Result' })).toBeInTheDocument();
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
  expect(await screen.findByText(/Explore 3 precomputed weekly predictions/)).toBeInTheDocument();
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

test('actual sales are never sent to another API from this page', async () => {
  mockHappyPath();
  await renderForecastChart();

  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: /show actual sales/i }));
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
