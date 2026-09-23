import React from 'react';
import { render, screen, within, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard, {
  niceDomain, formatFullDate, formatSelectedPeriod, formatDateRange, formatShortPeriod,
  formatFeatureValue, formatShapContribution, pickEvenIndices,
} from '../pages/forecast/Dashboard';
import { ThemeProvider } from '../context/ThemeContext';
import client from '../api/client';

// Same automock approach as the rest of this project's tests (see
// Login.test.jsx for why an inline mock factory can't be used here).
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

const METADATA = {
  forecasting: {
    weekly : { test_metrics: { MAE: 2173.8, RMSE: 3181.98, MAPE: 5.334, RMSPE: 7.362 } },
    monthly: { test_metrics: { MAE: 8462.3, RMSE: 11351.8, MAPE: 4.729, RMSPE: 6.283 } },
  },
};

const SHAP_ROW = (feature, featureValue, shapValue) => ({
  Store: 1, Period: '2015-05-18', Feature: feature,
  'Feature Value': featureValue, 'SHAP Value': shapValue,
  Effect: shapValue >= 0 ? 'Increases prediction' : 'Decreases prediction',
});

const LOCAL_SHAP = {
  store_id: 1, period: '2015-05-18', forecast_type: 'weekly', record_count: 5,
  explanation: [
    SHAP_ROW('PromoDays', 5, 1200.5),
    SHAP_ROW('sales_lag_1', 20000, -300.2),
    SHAP_ROW('WeekOfYear', 20, 150.1),
    SHAP_ROW('MonthStartDays', 0, -80.4),
    SHAP_ROW('CompetitionDistance', 1270, -10.1),
  ],
};

function mockHappyPath({ forecastType = 'weekly', forecasts = WEEKLY_FORECASTS } = {}) {
  client.get.mockImplementation((url) => {
    if (url.startsWith('/forecast/')) return Promise.resolve({ data: { forecasts } });
    if (url.startsWith('/metadata')) return Promise.resolve({ data: METADATA });
    if (url.startsWith('/shap/local')) return Promise.resolve({ data: LOCAL_SHAP });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

async function renderDashboard(props = {}) {
  const utils = render(
    <ThemeProvider>
      <Dashboard selectedStore={1} forecastType="weekly" {...props} />
    </ThemeProvider>
  );
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// The selected chart point renders its own SVG value label (e.g. "21,000")
// directly on the chart, independent of the KPI card showing the same
// number — a bare getByText('21,000') would match both. Scope to the KPI
// card itself via its field-label text.
function forecastedSalesValue() {
  return within(screen.getByText('Forecasted sales').closest('.metric-card')).getByText(/^[\d,]+$/);
}

// ---- Pure formatter/domain unit tests — exact, deterministic, and don't
// depend on fighting Recharts' SVG output in JSDOM. ----

describe('niceDomain', () => {
  test('is always zero-based with ~10% headroom rounded to a nice 1/2/4/5/6/8/10 ceiling', () => {
    // 21000 * 1.1 = 23100 -> falls in the (20000, 40000] bracket -> nice ceiling 40000
    expect(niceDomain([21000])).toEqual([0, 40000]);
    expect(niceDomain([9000])).toEqual([0, 10000]);
    expect(niceDomain([180])).toEqual([0, 200]);
  });

  test('does not overshoot to 100K for a ~69K max — the denser step set rounds to 80K', () => {
    // 69000 * 1.1 = 75900 -> falls in the (60000, 80000] bracket -> nice ceiling 80000
    expect(niceDomain([69000])).toEqual([0, 80000]);
  });

  test('includes actual values when they are passed in', () => {
    // max becomes 27450 * 1.1 = 30195 -> falls in the (20000, 40000] bracket -> 40000
    expect(niceDomain([21000, 27450])).toEqual([0, 40000]);
  });

  test('handles an empty/degenerate input safely', () => {
    expect(niceDomain([])).toEqual([0, 1]);
  });
});

describe('date/period formatters', () => {
  test('formats a full date as "4 May 2015"', () => {
    expect(formatFullDate('2015-05-04')).toBe('4 May 2015');
  });

  test('formats a weekly selected period as "Week beginning 4 May 2015"', () => {
    expect(formatSelectedPeriod('2015-05-04', 'weekly')).toBe('Week beginning 4 May 2015');
  });

  test('formats a monthly selected period as "May 2015"', () => {
    expect(formatSelectedPeriod('2015-05-01', 'monthly')).toBe('May 2015');
  });

  test('formats a weekly date range as "4 May–27 July 2015"', () => {
    const range = formatDateRange(['2015-05-04', '2015-06-15', '2015-07-27'], 'weekly');
    expect(range).toBe('4 May–27 July 2015');
  });

  test('formats a monthly date range as "May–July 2015"', () => {
    const range = formatDateRange(['2015-05-01', '2015-06-01', '2015-07-01'], 'monthly');
    expect(range).toBe('May–July 2015');
  });

  test('formats a compact weekly period as "27 Jul 2015"', () => {
    expect(formatShortPeriod('2015-07-27', 'weekly')).toBe('27 Jul 2015');
  });

  test('formats a compact monthly period as "Jul 2015"', () => {
    expect(formatShortPeriod('2015-07-01', 'monthly')).toBe('Jul 2015');
  });
});

describe('pickEvenIndices', () => {
  test('picks exactly 4 evenly-spaced indices for 13 items, including first and last', () => {
    expect(pickEvenIndices(13, 4)).toEqual(new Set([0, 4, 8, 12]));
  });

  test('returns every index when there are already fewer items than the target count', () => {
    expect(pickEvenIndices(3, 4)).toEqual(new Set([0, 1, 2]));
  });

  test('returns every index when the item count exactly equals the target count', () => {
    expect(pickEvenIndices(4, 4)).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe('SHAP value formatters', () => {
  test('formats a sales-type feature value with thousands separators and a unit', () => {
    expect(formatFeatureValue('sales_lag_1', 57399.4167)).toBe('57,399 sales');
  });

  test('formats a day-count feature value with its unit', () => {
    expect(formatFeatureValue('PromoDays', 5)).toBe('5 promotion days');
    expect(formatFeatureValue('WeekendDays', 0)).toBe('0 weekend days');
  });

  test('formats an unmapped feature as a plain rounded number', () => {
    expect(formatFeatureValue('WeekOfYear', 20)).toBe('20');
  });

  test('formats a positive SHAP contribution with a + sign and unit', () => {
    expect(formatShapContribution(6768.5)).toBe('+6,769 predicted sales');
  });

  test('formats a negative SHAP contribution with a real minus sign and unit', () => {
    expect(formatShapContribution(-3144.8)).toBe('−3,145 predicted sales');
  });
});

// ---- Integration tests ----

test('shows the dynamic period count and date range, not a hard-coded "13"', async () => {
  mockHappyPath();
  await renderDashboard();

  expect(screen.getByText('3 weekly predictions')).toBeInTheDocument();
  expect(screen.getByText('4 May–18 May 2015')).toBeInTheDocument();
});

test('shows correct weekly explanatory text (same week last year, not month)', async () => {
  mockHappyPath();
  await renderDashboard();

  expect(screen.getByText(/same week last year/)).toBeInTheDocument();
});

test('shows correct monthly explanatory text (3 monthly predictions, same month last year — not 6)', async () => {
  mockHappyPath({ forecastType: 'monthly', forecasts: MONTHLY_FORECASTS });
  await renderDashboard({ forecastType: 'monthly' });

  expect(screen.getByText('3 monthly predictions')).toBeInTheDocument();
  expect(screen.getByText(/same month last year/)).toBeInTheDocument();
});

test('changing the selected store refetches forecast data for the new store', async () => {
  mockHappyPath();
  const { rerender } = await renderDashboard({ selectedStore: 1 });

  expect(client.get).toHaveBeenCalledWith(expect.stringContaining('/forecast/1'));

  await act(async () => {
    rerender(
      <ThemeProvider>
        <Dashboard selectedStore={7} forecastType="weekly" />
      </ThemeProvider>
    );
  });

  expect(client.get).toHaveBeenCalledWith(expect.stringContaining('/forecast/7'));
});

test('stepping to the previous period updates the period-dependent KPIs and refetches local SHAP', async () => {
  mockHappyPath();
  await renderDashboard();

  // Defaults to the latest period (18 May): Forecasted sales = 21,000
  expect(forecastedSalesValue()).toHaveTextContent('21,000');

  client.get.mockClear();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
  });

  expect(forecastedSalesValue()).toHaveTextContent('22,000'); // 11 May's prediction
  expect(client.get).toHaveBeenCalledWith(expect.stringContaining('period=2015-05-11'));
});

test('stepping back to the first period shows the "no previous period" KPI text, and Previous becomes disabled', async () => {
  mockHappyPath();
  await renderDashboard();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); }); // -> 11 May
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); }); // -> 4 May (first)

  expect(forecastedSalesValue()).toHaveTextContent('20,000');
  expect(screen.getByText('No previous period')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous period' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next period' })).toBeEnabled();
});

test('Next is disabled at the latest period by default', async () => {
  mockHappyPath();
  await renderDashboard();

  expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();
});

test('"Show actual sales" is off initially, and the switch label/heading update once enabled', async () => {
  mockHappyPath();
  await renderDashboard();

  expect(screen.queryByText('Historical evaluation')).not.toBeInTheDocument();
  const toggle = screen.getByRole('switch', { name: /show actual sales/i });
  expect(toggle).toHaveAttribute('aria-checked', 'false');

  await act(async () => { fireEvent.click(toggle); });

  expect(screen.getByRole('switch', { name: /hide actual sales/i })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('Historical evaluation')).toBeInTheDocument();
});

test('enabling actual-sales comparison reveals the correct historical evaluation values', async () => {
  mockHappyPath();
  await renderDashboard();

  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: /show actual sales/i }));
  });

  // Latest period: prediction 21000, actual 20900 -> error +100, abs error 100
  expect(screen.getByText('20,900')).toBeInTheDocument();
  expect(screen.getByText('+100')).toBeInTheDocument();
  const expectedApe = ((100 / 20900) * 100).toFixed(1);
  expect(screen.getByText(`${expectedApe}%`)).toBeInTheDocument();
});

test('shows an empty state when the store has no forecasts, instead of crashing', async () => {
  mockHappyPath({ forecasts: [] });
  await renderDashboard();

  expect(screen.getByText('No forecasts for this store')).toBeInTheDocument();
});

test('shows an error banner with a working retry on API failure', async () => {
  client.get.mockRejectedValue(new Error('network down'));
  await renderDashboard();

  expect(screen.getByRole('alert')).toBeInTheDocument();
  const callsBefore = client.get.mock.calls.length;

  mockHappyPath();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  });

  expect(client.get.mock.calls.length).toBeGreaterThan(callsBefore);
  expect(await screen.findByText('Recommended next step')).toBeInTheDocument();
});

test('the recommendation button is disabled until the local SHAP evidence has loaded, then enabled', async () => {
  let resolveShap;
  client.get.mockImplementation((url) => {
    if (url.startsWith('/forecast/')) return Promise.resolve({ data: { forecasts: WEEKLY_FORECASTS } });
    if (url.startsWith('/metadata')) return Promise.resolve({ data: METADATA });
    if (url.startsWith('/shap/local')) return new Promise(resolve => { resolveShap = resolve; });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  await renderDashboard();

  const button = screen.getByRole('button', { name: /generate recommendations/i });
  expect(button).toBeDisabled();

  await act(async () => { resolveShap({ data: LOCAL_SHAP }); });

  expect(button).toBeEnabled();
});

test('generating a recommendation never includes actual sales in the request', async () => {
  mockHappyPath();
  client.post.mockResolvedValue({
    data: { store_id: 1, period: '2015-05-18', forecast_type: 'weekly', predicted_sales: 21000,
      recommendations: {
        staffing: { recommendation: 'x', detail: 'y', urgency: 'low' },
        stock: { recommendation: 'x', detail: 'y', urgency: 'medium' },
        promotions: { recommendation: 'x', detail: 'y', urgency: 'low' },
        summary: 'All steady.',
      } },
  });
  await renderDashboard();
  await waitFor(() => expect(screen.getByRole('button', { name: /generate recommendations/i })).toBeEnabled());

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate recommendations/i }));
  });

  expect(client.post).toHaveBeenCalledTimes(1);
  const [url, body] = client.post.mock.calls[0];
  expect(url).toBe('/agent/recommend?store_id=1&forecast_type=weekly&period=2015-05-18');
  expect(url).not.toMatch(/actual/i);
  expect(body).toBeUndefined();
  expect(await screen.findByText('All steady.')).toBeInTheDocument();
});

test('the period navigator and segmented controls are real, natively keyboard-operable <button> elements', async () => {
  mockHappyPath();
  await renderDashboard();

  const prevButton = screen.getByRole('button', { name: 'Previous period' });
  expect(prevButton.tagName).toBe('BUTTON');
  expect(prevButton).not.toHaveAttribute('tabindex', '-1');

  const compareSwitch = screen.getByRole('switch', { name: /show actual sales/i });
  expect(compareSwitch.tagName).toBe('BUTTON');
});
