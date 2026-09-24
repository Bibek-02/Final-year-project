import React from 'react';
import { render, screen, within, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard, {
  niceDomain, focusedDomain, formatFullDate, formatSelectedPeriod, formatDateRange, formatShortPeriod,
  formatFeatureValue, formatShapContribution, pickEvenIndices, describePeriodChange, topShapDrivers,
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

describe('niceDomain (zero-based / "Start at zero" mode)', () => {
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

describe('focusedDomain (default, data-driven Y-axis mode)', () => {
  test('pads the observed range ~10% and rounds both ends to a shared nice step', () => {
    // predicted+actual pool from WEEKLY_FORECASTS: 19500–22000
    expect(focusedDomain([19500, 20000, 21800, 22000, 20900, 21000])).toEqual([19000, 23000]);
  });

  test('a constant series has no range to focus on, so it defers to the zero-based domain', () => {
    expect(focusedDomain([20000, 20000, 20000])).toEqual(niceDomain([20000, 20000, 20000]));
  });

  test('handles an empty input safely', () => {
    expect(focusedDomain([])).toEqual([0, 1]);
  });

  test('an all-zero series defers to the zero-based domain rather than an invalid range', () => {
    expect(focusedDomain([0, 0, 0])).toEqual([0, 1]);
  });

  test('never lets the floor go negative, even when padding would push it below zero', () => {
    const [floor, ceiling] = focusedDomain([5, 100]);
    expect(floor).toBe(0);
    expect(ceiling).toBeGreaterThan(100);
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

describe('describePeriodChange', () => {
  test('reports no previous period honestly for the first period in the window (not "0%")', () => {
    const result = describePeriodChange({ prediction: 20000 }, null);
    expect(result.state).toBe('no-previous');
    expect(result.text).toBe('No previous period');
  });

  test('reports "Not calculable" — not "0%" — when the previous prediction was exactly zero', () => {
    const result = describePeriodChange({ prediction: 20000 }, { prediction: 0 });
    expect(result.state).toBe('zero-previous');
    expect(result.text).toBe('Not calculable');
  });

  test('computes a normal positive percentage change with a leading +', () => {
    const result = describePeriodChange({ prediction: 22000 }, { prediction: 20000 });
    expect(result.state).toBe('ok');
    expect(result.text).toBe('+10.0%');
    expect(result.direction).toBe('up');
  });

  test('computes a negative percentage change with a real minus sign, not an ASCII hyphen', () => {
    const result = describePeriodChange({ prediction: 21000 }, { prediction: 22000 });
    expect(result.text).toBe('−4.5%');
    expect(result.text).not.toContain('-4.5'); // ASCII hyphen would also match "−4.5" visually — assert the real char
    expect(result.direction).toBe('down');
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

  test('formats a positive SHAP contribution with a + sign, no repeated unit suffix', () => {
    expect(formatShapContribution(6768.5)).toBe('+6,769');
  });

  test('formats a negative SHAP contribution with a real minus sign, no repeated unit suffix', () => {
    expect(formatShapContribution(-3144.8)).toBe('−3,145');
  });
});

describe('topShapDrivers', () => {
  test('re-sorts by absolute SHAP value descending and takes the top N, even from an unsorted input', () => {
    const shuffled = [
      { Feature: 'A', 'SHAP Value': 10 },
      { Feature: 'B', 'SHAP Value': -500 },
      { Feature: 'C', 'SHAP Value': 200 },
      { Feature: 'D', 'SHAP Value': -50 },
    ];
    expect(topShapDrivers(shuffled, 3).map(r => r.Feature)).toEqual(['B', 'C', 'D']);
  });

  test('defaults to the top 3', () => {
    const rows = [
      { Feature: 'A', 'SHAP Value': 1 }, { Feature: 'B', 'SHAP Value': 5 },
      { Feature: 'C', 'SHAP Value': -3 }, { Feature: 'D', 'SHAP Value': 2 },
    ];
    expect(topShapDrivers(rows).map(r => r.Feature)).toEqual(['B', 'C', 'D']);
  });
});

// ---- Integration tests ----

test('shows the dynamic period count and date range, not a hard-coded "13"', async () => {
  mockHappyPath();
  await renderDashboard();

  expect(screen.getByText(/Historical test predictions/)).toBeInTheDocument();
  expect(screen.getByText(/4 May–18 May 2015/)).toBeInTheDocument();
  expect(screen.getByText(/3 predictions/)).toBeInTheDocument();
});

test('monthly forecasts show the correct dynamic count and date range, not a hard-coded weekly one', async () => {
  mockHappyPath({ forecastType: 'monthly', forecasts: MONTHLY_FORECASTS });
  await renderDashboard({ forecastType: 'monthly' });

  expect(screen.getByText(/3 predictions/)).toBeInTheDocument();
  expect(screen.getByText(/May–July 2015/)).toBeInTheDocument();
});

test('the "What does this mean?" disclosure explains these are saved, evaluated predictions', async () => {
  mockHappyPath();
  await renderDashboard();

  await act(async () => {
    fireEvent.click(screen.getByText('What does this mean?'));
  });
  expect(screen.getByText(/saved predictions from a held-out test period/i)).toBeInTheDocument();
  expect(screen.getByText(/not a live forecast/i)).toBeInTheDocument();
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

test('the "Change from previous period" KPI uses identical styling for an increase and a decrease (tone-neutral)', async () => {
  mockHappyPath();
  await renderDashboard();

  // Default (18 May): prediction 21,000 vs previous 22,000 -> a decrease.
  const decreaseCard = screen.getByText('Change from previous period').closest('.metric-card');
  const decreaseClass = within(decreaseCard).getByText('−4.5%').className;

  // Step back to 11 May: prediction 22,000 vs previous 20,000 -> an increase.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); });
  const increaseCard = screen.getByText('Change from previous period').closest('.metric-card');
  const increaseClass = within(increaseCard).getByText('+10.0%').className;

  expect(increaseClass).toBe(decreaseClass);
});

test('"Actual sales" toggle has a stable accessible name that does not change with its state', async () => {
  mockHappyPath();
  await renderDashboard();

  const toggle = screen.getByRole('switch', { name: /^actual sales$/i });
  expect(toggle).toHaveAttribute('aria-checked', 'false');

  await act(async () => { fireEvent.click(toggle); });

  // Same query still finds it — the accessible name never changed.
  expect(screen.getByRole('switch', { name: /^actual sales$/i })).toHaveAttribute('aria-checked', 'true');
});

test('"View values" shows exact figures for the selected period without needing to hover the chart', async () => {
  mockHappyPath();
  await renderDashboard();

  await act(async () => {
    fireEvent.click(screen.getByText('View values'));
  });
  const details = screen.getByText('View values').closest('details');
  expect(within(details).getByText('21,000')).toBeInTheDocument(); // latest period's predicted sales
  expect(within(details).queryByText('20,900')).not.toBeInTheDocument(); // actual sales not shown yet

  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: /^actual sales$/i }));
  });
  expect(within(details).getByText('20,900')).toBeInTheDocument();
});

test('"Start at zero" is a secondary control that toggles the Y-axis mode', async () => {
  mockHappyPath();
  await renderDashboard();

  const zeroToggle = screen.getByRole('button', { name: /start at zero/i });
  expect(zeroToggle).toHaveAttribute('aria-pressed', 'false');

  await act(async () => { fireEvent.click(zeroToggle); });

  expect(screen.getByRole('button', { name: /show focused range/i })).toHaveAttribute('aria-pressed', 'true');
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
  expect(await screen.findByText('Forecasted sales')).toBeInTheDocument();
});

test('the SHAP panel shows the top 3 contributions with full labels, signed values, and explicit direction text', async () => {
  mockHappyPath();
  await renderDashboard();

  expect(screen.getByText('What influenced this prediction?')).toBeInTheDocument();
  expect(screen.getByText('Promotion activity')).toBeInTheDocument();
  expect(screen.getByText('+1,201 · Raises prediction')).toBeInTheDocument();
  expect(screen.getByText('Previous period sales')).toBeInTheDocument();
  expect(screen.getByText('−300 · Lowers prediction')).toBeInTheDocument();
  expect(screen.getByText('Week of year')).toBeInTheDocument();
  expect(screen.getByText('+150 · Raises prediction')).toBeInTheDocument();
  // Only the top 3 of the 5 mocked rows are shown.
  expect(screen.queryByText('Month-start timing')).not.toBeInTheDocument();
  expect(screen.queryByText('Competition proximity')).not.toBeInTheDocument();
  expect(screen.getByText(/Showing the 3 largest of 5 modelled features/)).toBeInTheDocument();
});

test('re-sorts SHAP rows by absolute magnitude even when the API response is not already sorted', async () => {
  const shuffled = {
    store_id: 1, period: '2015-05-18', forecast_type: 'weekly', record_count: 5,
    explanation: [
      SHAP_ROW('MonthStartDays', 0, -80.4),
      SHAP_ROW('CompetitionDistance', 1270, -10.1),
      SHAP_ROW('sales_lag_1', 20000, -300.2),
      SHAP_ROW('WeekOfYear', 20, 150.1),
      SHAP_ROW('PromoDays', 5, 1200.5), // largest |SHAP| deliberately placed last
    ],
  };
  client.get.mockImplementation((url) => {
    if (url.startsWith('/forecast/')) return Promise.resolve({ data: { forecasts: WEEKLY_FORECASTS } });
    if (url.startsWith('/shap/local')) return Promise.resolve({ data: shuffled });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  await renderDashboard();

  // The largest-magnitude row, though placed last in the mocked response,
  // must still be shown as a top driver — and the 4th-largest excluded.
  expect(screen.getByText('Promotion activity')).toBeInTheDocument();
  expect(screen.queryByText('Month-start timing')).not.toBeInTheDocument();
});

test('the "How to read this" disclosure states the required SHAP caveat verbatim', async () => {
  mockHappyPath();
  await renderDashboard();

  await act(async () => {
    fireEvent.click(screen.getByText('How to read this'));
  });
  expect(screen.getByText(
    'SHAP shows how inputs contribute to raising or lowering a model prediction relative to its '
    + 'baseline. These contributions explain the prediction; they do not prove that changing an '
    + 'input will cause the same change in actual sales.'
  )).toBeInTheDocument();
});

test('Dashboard never itself calls the recommendation-generation API', async () => {
  mockHappyPath();
  const setActivePage = jest.fn();
  const setHandoffPeriod = jest.fn();
  await renderDashboard({ setActivePage, setHandoffPeriod });

  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: /^actual sales$/i }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
  });

  expect(client.post).not.toHaveBeenCalled();
});

test('"Open AI Recommendations" hands off the selected period before navigating', async () => {
  mockHappyPath();
  const setActivePage = jest.fn();
  const setHandoffPeriod = jest.fn();
  await renderDashboard({ setActivePage, setHandoffPeriod });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); // -> 2015-05-11
  });

  fireEvent.click(screen.getByRole('button', { name: /open ai recommendations/i }));

  expect(setHandoffPeriod).toHaveBeenCalledWith('2015-05-11');
  expect(setActivePage).toHaveBeenCalledWith('agent');
});

test('"View full forecast" hands off the selected period before navigating to the Forecast page', async () => {
  mockHappyPath();
  const setActivePage = jest.fn();
  const setHandoffPeriod = jest.fn();
  await renderDashboard({ setActivePage, setHandoffPeriod });

  fireEvent.click(screen.getByRole('button', { name: /view full forecast/i }));

  expect(setHandoffPeriod).toHaveBeenCalledWith('2015-05-18'); // latest period, default selection
  expect(setActivePage).toHaveBeenCalledWith('forecast');
});

test('"View full explanation" hands off the selected period before navigating to the Explanation page', async () => {
  mockHappyPath();
  const setActivePage = jest.fn();
  const setHandoffPeriod = jest.fn();
  await renderDashboard({ setActivePage, setHandoffPeriod });

  fireEvent.click(screen.getByRole('button', { name: /view full explanation/i }));

  expect(setHandoffPeriod).toHaveBeenCalledWith('2015-05-18');
  expect(setActivePage).toHaveBeenCalledWith('explanation');
});

test('handoff links and the recommendation handoff card are absent when no page navigator is supplied', async () => {
  mockHappyPath();
  await renderDashboard();

  expect(screen.queryByRole('button', { name: /view full forecast/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /view full explanation/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /open ai recommendations/i })).not.toBeInTheDocument();
});

test('the Model Comparison link navigates to the model evaluation page', async () => {
  mockHappyPath();
  const setActivePage = jest.fn();
  await renderDashboard({ setActivePage });

  fireEvent.click(screen.getByRole('button', { name: /model comparison/i }));
  expect(setActivePage).toHaveBeenCalledWith('compare');
});

test('the period navigator and segmented controls are real, natively keyboard-operable <button> elements', async () => {
  mockHappyPath();
  await renderDashboard();

  const prevButton = screen.getByRole('button', { name: 'Previous period' });
  expect(prevButton.tagName).toBe('BUTTON');
  expect(prevButton).not.toHaveAttribute('tabindex', '-1');

  const compareSwitch = screen.getByRole('switch', { name: /^actual sales$/i });
  expect(compareSwitch.tagName).toBe('BUTTON');
});
