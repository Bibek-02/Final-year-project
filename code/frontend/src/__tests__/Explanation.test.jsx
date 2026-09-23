import React from 'react';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import Explanation, {
  formatShortPeriod, formatSelectedPeriod, formatFeatureValue, formatShapContribution,
  normalizeGlobalRows, buildGlobalShapSummary, buildLocalExplanation, getTopDrivers,
  buildLocalShapSummary, buildWaterfall, buildBusinessInterpretation,
} from '../pages/explain/Explanation';
import { ThemeProvider } from '../context/ThemeContext';
import client from '../api/client';

// Same automock approach as the rest of this project's tests (see
// Login.test.jsx for why an inline mock factory can't be used here).
jest.mock('../api/client');

const WEEKLY_FORECASTS = [
  { period: '2015-07-13', prediction: 25000, actual_sales: 24500 },
  { period: '2015-07-20', prediction: 26000, actual_sales: 25800 },
  { period: '2015-07-27', prediction: 26872, actual_sales: null },
];

const MONTHLY_FORECASTS = [
  { period: '2015-05-01', prediction: 108000, actual_sales: 106500 },
  { period: '2015-06-01', prediction: 110000, actual_sales: 109200 },
  { period: '2015-07-01', prediction: 112450, actual_sales: null },
];

// Real values from the weekly_global_shap_importance.csv artifact.
const GLOBAL_WEEKLY = [
  { Feature: 'PromoDays', 'Readable Feature': 'promotion activity', Mean_SHAP: 5809.7847 },
  { Feature: 'rolling_mean_12', 'Readable Feature': 'recent 12-week average sales', Mean_SHAP: 3662.9463 },
  { Feature: 'sales_lag_52', 'Readable Feature': 'sales fifty-two weeks ago', Mean_SHAP: 2850.4868 },
  { Feature: 'EMA_8', 'Readable Feature': 'recent 8-week weighted sales trend', Mean_SHAP: 1595.13 },
  { Feature: 'rolling_mean_4', 'Readable Feature': 'recent 4-week average sales', Mean_SHAP: 1322.6946 },
  { Feature: 'OpenDays', 'Readable Feature': 'number of open days', Mean_SHAP: 714.4004 },
  { Feature: 'EMA_4', 'Readable Feature': 'recent 4-week weighted sales trend', Mean_SHAP: 576.77496 },
  { Feature: 'WeekOfYear', 'Readable Feature': 'week of year', Mean_SHAP: 541.00555 },
  { Feature: 'SchoolHolidayDays', 'Readable Feature': 'school holiday period', Mean_SHAP: 526.1519 },
  { Feature: 'rolling_mean_8', 'Readable Feature': 'recent 8-week average sales', Mean_SHAP: 478.8478 },
];

// Named row helper for local explanation fixtures. Rows must arrive
// pre-sorted by |SHAP Value| descending, exactly like the real API.
const LOCAL_ROW = (feature, readable, featureValue, shapValue) => ({
  Store: 1, Period: '2015-07-27', Feature: feature, 'Readable Feature': readable,
  'Feature Value': featureValue, 'SHAP Value': shapValue,
  Effect: shapValue > 0 ? 'Increases prediction' : shapValue < 0 ? 'Decreases prediction' : 'No effect',
});

// 6 named top contributors + 14 "other" rows, chosen so
// baseline (40,542) + Σcontributions (−13,670) = predicted sales (26,872) —
// the exact numbers used as examples throughout the task spec.
const LOCAL_TOP6 = [
  LOCAL_ROW('rolling_mean_12', 'recent 12-week average sales', 25372, -5085),
  LOCAL_ROW('PromoDays', 'promotion activity', 5, 4476),
  LOCAL_ROW('sales_lag_52', 'sales fifty-two weeks ago', 31910, -2797),
  LOCAL_ROW('EMA_8', 'recent 8-week weighted sales trend', 25893, -1754),
  LOCAL_ROW('sales_lag_2', 'sales two periods ago', 20670, -900),
  LOCAL_ROW('rolling_mean_4', 'recent 4-week average sales', 24101, -750),
];
const LOCAL_OTHER_FEATURES = [
  'Year', 'Month', 'WeekOfYear', 'Quarter', 'CompetitionDistance', 'TimeIndex',
  'StateHolidayDays', 'WeekendDays', 'MonthStartDays', 'MonthEndDays',
  'OpenDays', 'SchoolHolidayDays', 'periods_since_last_promo', 'sales_lag_1',
];
const LOCAL_OTHER = LOCAL_OTHER_FEATURES.map(f => LOCAL_ROW(f, f, 1, -490));
const LOCAL_ROWS = [...LOCAL_TOP6, ...LOCAL_OTHER];

const LOCAL_SHAP_RESPONSE = {
  store_id: 1, period: '2015-07-27', forecast_type: 'weekly', record_count: LOCAL_ROWS.length,
  explanation: LOCAL_ROWS,
};

function mockHappyPath({ forecastType = 'weekly', forecasts = WEEKLY_FORECASTS, global = GLOBAL_WEEKLY,
  local = LOCAL_SHAP_RESPONSE } = {}) {
  client.get.mockImplementation((url) => {
    if (url.startsWith('/shap/global')) return Promise.resolve({ data: { features: global } });
    if (url.startsWith('/shap/local')) return Promise.resolve({ data: local });
    if (url.startsWith('/forecast/')) return Promise.resolve({ data: { forecasts } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

async function renderExplanation(props = {}) {
  const utils = render(
    <ThemeProvider>
      <Explanation selectedStore={1} forecastType="weekly" {...props} />
    </ThemeProvider>
  );
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---- Pure formatter/logic unit tests ----

describe('period formatters', () => {
  test('formats a compact weekly period as "27 Jul 2015"', () => {
    expect(formatShortPeriod('2015-07-27', 'weekly')).toBe('27 Jul 2015');
  });

  test('formats a compact monthly period as "Jul 2015"', () => {
    expect(formatShortPeriod('2015-07-01', 'monthly')).toBe('Jul 2015');
  });

  test('formats a weekly selected period as "Week beginning 27 July 2015"', () => {
    expect(formatSelectedPeriod('2015-07-27', 'weekly')).toBe('Week beginning 27 July 2015');
  });

  test('formats a monthly selected period as "July 2015"', () => {
    expect(formatSelectedPeriod('2015-07-01', 'monthly')).toBe('July 2015');
  });
});

describe('formatFeatureValue', () => {
  test('formats a sales-type feature value with thousands separators and a unit', () => {
    expect(formatFeatureValue('sales_lag_1', 29014.92)).toBe('29,015 sales');
  });

  test('formats a day-count feature value with its unit', () => {
    expect(formatFeatureValue('PromoDays', 5)).toBe('5 promotion days');
    expect(formatFeatureValue('WeekendDays', 0)).toBe('0 weekend days');
  });

  test('singularizes the unit for an exact count of 1, leaving other counts plural', () => {
    expect(formatFeatureValue('PromoDays', 1)).toBe('1 promotion day');
    expect(formatFeatureValue('WeekendDays', 1)).toBe('1 weekend day');
    expect(formatFeatureValue('sales_lag_1', 1)).toBe('1 sale');
    expect(formatFeatureValue('WeekendDays', 2)).toBe('2 weekend days');
  });

  test('formats an unmapped feature as a plain rounded number', () => {
    expect(formatFeatureValue('WeekOfYear', 20)).toBe('20');
  });

  test('formats a binary/dummy feature as Yes/No, not a bare digit', () => {
    expect(formatFeatureValue('StoreType_a', 1)).toBe('Yes');
    expect(formatFeatureValue('Promo2', 0)).toBe('No');
  });
});

describe('formatShapContribution', () => {
  test('formats a positive contribution with a + sign and unit', () => {
    expect(formatShapContribution(5215.5703)).toBe('+5,216 predicted sales');
  });

  test('formats a negative contribution with a real minus sign, not a hyphen', () => {
    expect(formatShapContribution(-4099.4434)).toBe('−4,099 predicted sales');
  });

  test('formats an exact-zero contribution as no effect', () => {
    expect(formatShapContribution(0)).toBe('No effect on predicted sales');
  });
});

describe('normalizeGlobalRows', () => {
  test('sorts by mean absolute SHAP descending and prefers the artifact readable label', () => {
    const shuffled = [GLOBAL_WEEKLY[2], GLOBAL_WEEKLY[0], GLOBAL_WEEKLY[1]];
    const rows = normalizeGlobalRows(shuffled);
    expect(rows.map(r => r.rawFeature)).toEqual(['PromoDays', 'rolling_mean_12', 'sales_lag_52']);
    expect(rows[0].label).toBe('Promotion activity');
  });

  test('falls back to the JS dict/prefix rules when the artifact leaves a feature un-humanized', () => {
    const rows = normalizeGlobalRows([{ Feature: 'StoreType_a', 'Readable Feature': 'StoreType_a', Mean_SHAP: 60.3 }]);
    expect(rows[0].label).toBe('Store type: A');
  });
});

describe('buildGlobalShapSummary', () => {
  test('builds a deterministic sentence from the top 3 sorted rows, using only their own labels', () => {
    const rows = normalizeGlobalRows(GLOBAL_WEEKLY);
    expect(buildGlobalShapSummary(rows, 'weekly')).toBe(
      'Promotion activity has the largest average influence on weekly predictions, '
      + 'followed by recent 12-week average sales and sales fifty-two weeks ago.'
    );
  });

  test('degrades gracefully for fewer than 3 rows', () => {
    const one = normalizeGlobalRows([GLOBAL_WEEKLY[0]]);
    expect(buildGlobalShapSummary(one, 'weekly')).toBe('Promotion activity has the largest average influence on weekly predictions.');
    expect(buildGlobalShapSummary([], 'weekly')).toBe('');
  });

  test('never hardcodes a feature name — a synthetic input with unrelated features drives the sentence', () => {
    const synthetic = normalizeGlobalRows([
      { Feature: 'Foo', 'Readable Feature': 'synthetic foo factor', Mean_SHAP: 99 },
      { Feature: 'Bar', 'Readable Feature': 'synthetic bar factor', Mean_SHAP: 50 },
    ]);
    expect(buildGlobalShapSummary(synthetic, 'monthly')).toBe(
      'Synthetic foo factor has the largest average influence on monthly predictions, followed by synthetic bar factor.'
    );
  });
});

describe('buildLocalExplanation and getTopDrivers/buildLocalShapSummary', () => {
  const localExplanation = buildLocalExplanation({
    localData: LOCAL_SHAP_RESPONSE, forecasts: WEEKLY_FORECASTS, selectedStore: 1, forecastType: 'weekly',
  });

  test('derives baseline from prediction minus the SHAP sum, matching the spec worked example', () => {
    expect(localExplanation.predictedSales).toBe(26872);
    expect(Math.round(localExplanation.sumShap)).toBe(-13670);
    expect(Math.round(localExplanation.baseline)).toBe(40542);
    expect(localExplanation.reconciliationOk).toBe(true);
  });

  test('exposes the dynamic total feature count from record_count, not a hardcoded number', () => {
    expect(localExplanation.totalFeatureCount).toBe(20);
  });

  test('flags reconciliation failure when the matched forecast cannot be found', () => {
    const broken = buildLocalExplanation({
      localData: { ...LOCAL_SHAP_RESPONSE, period: '1999-01-01' },
      forecasts: WEEKLY_FORECASTS, selectedStore: 1, forecastType: 'weekly',
    });
    expect(broken.reconciliationOk).toBe(false);
  });

  test('identifies the largest-increase and largest-decrease drivers', () => {
    const { increase, decrease } = getTopDrivers(localExplanation.contributions);
    expect(increase.rawFeature).toBe('PromoDays');
    expect(increase.shapValue).toBe(4476);
    expect(decrease.rawFeature).toBe('rolling_mean_12');
    expect(decrease.shapValue).toBe(-5085);
  });

  test('builds a deterministic plain-English summary sentence', () => {
    expect(buildLocalShapSummary(localExplanation.contributions)).toBe(
      'Promotion activity increased this prediction, while recent 12-week average sales had the largest decreasing effect.'
    );
  });
});

describe('buildWaterfall', () => {
  const localExplanation = buildLocalExplanation({
    localData: LOCAL_SHAP_RESPONSE, forecasts: WEEKLY_FORECASTS, selectedStore: 1, forecastType: 'weekly',
  });
  const rows = buildWaterfall(localExplanation);

  test('starts with the baseline and ends with predicted sales', () => {
    expect(rows[0].name).toBe('Baseline model output');
    expect(Math.round(rows[0].display)).toBe(40542);
    expect(rows[rows.length - 1].name).toBe('Predicted sales');
    expect(Math.round(rows[rows.length - 1].display)).toBe(26872);
  });

  test('shows exactly the top 6 named contributors', () => {
    const named = rows.filter(r => !r.isTotal && !r.isOther);
    expect(named).toHaveLength(6);
    expect(named[0].rawFeature).toBe('rolling_mean_12');
    expect(Math.round(named[0].display)).toBe(-5085);
    expect(named[1].rawFeature).toBe('PromoDays');
    expect(Math.round(named[1].display)).toBe(4476);
  });

  test('folds the remaining features into a dynamically-labeled "Other N" step, N = total - 6', () => {
    const other = rows.find(r => r.isOther);
    expect(other.name).toBe('Other 14 features (net)');
    expect(Math.round(other.display)).toBe(-6860);
  });
});

describe('buildBusinessInterpretation', () => {
  const localExplanation = buildLocalExplanation({
    localData: LOCAL_SHAP_RESPONSE, forecasts: WEEKLY_FORECASTS, selectedStore: 1, forecastType: 'weekly',
  });

  test('describes a net-negative forecast using the top negative and positive drivers, with approved non-causal phrasing', () => {
    const text = buildBusinessInterpretation(localExplanation);
    expect(text).toBe(
      "The weekly forecast of 26,872 is 13,670 below the model's baseline output. "
      + 'Negative model contributions from recent 12-week average sales and sales fifty-two weeks ago '
      + 'reduced the prediction more than promotion activity increased it.'
    );
    expect(text.toLowerCase()).not.toContain('caused');
    expect(text).not.toContain('Store');
  });

  test('describes a net-positive forecast, naming the strongest upward drivers and an offsetting decrease', () => {
    const positiveExplanation = {
      forecastType: 'monthly', predictedSales: 112450, baseline: 104230, sumShap: 8220,
      contributions: [
        { rawFeature: 'PromoDays', label: 'Promotion activity', shapValue: 5200 },
        { rawFeature: 'rolling_mean_4', label: 'Recent 4-week average sales', shapValue: 3900 },
        { rawFeature: 'WeekOfYear', label: 'Week of year', shapValue: -880 },
      ],
    };
    expect(buildBusinessInterpretation(positiveExplanation)).toBe(
      "The monthly forecast of 112,450 is 8,220 above the model's baseline output. "
      + 'Promotion activity and recent 4-week average sales increased the prediction, '
      + 'while week of year partly offset the increase.'
    );
  });

  test('degrades gracefully with no offsetting drivers on either side', () => {
    const onlyNegative = {
      forecastType: 'weekly', predictedSales: 20000, baseline: 22000, sumShap: -2000,
      contributions: [{ rawFeature: 'rolling_mean_12', label: 'Recent 12-week average sales', shapValue: -2000 }],
    };
    expect(buildBusinessInterpretation(onlyNegative)).toBe(
      "The weekly forecast of 20,000 is 2,000 below the model's baseline output. "
      + 'Negative model contributions from recent 12-week average sales reduced the prediction.'
    );
  });

  test('reports a near-zero net adjustment as close to baseline rather than forcing a direction', () => {
    const nearZero = {
      forecastType: 'weekly', predictedSales: 30000, baseline: 30000.4, sumShap: -0.4,
      contributions: [{ rawFeature: 'PromoDays', label: 'Promotion activity', shapValue: -0.4 }],
    };
    expect(buildBusinessInterpretation(nearZero)).toBe(
      "The weekly forecast of 30,000 is close to the model's baseline output, "
      + 'as increasing and decreasing feature contributions largely offset each other.'
    );
  });

  test('returns an empty string when there is no local explanation to interpret', () => {
    expect(buildBusinessInterpretation(null)).toBe('');
    expect(buildBusinessInterpretation({ contributions: [], predictedSales: null, sumShap: 0 })).toBe('');
  });
});

// ---- Integration tests ----

test('the About SHAP card leads with the two-level model-behaviour/selected-forecast framing', async () => {
  mockHappyPath();
  await renderExplanation();

  expect(screen.getByText(
    'SHAP estimates how features influence model predictions at two levels: overall model '
    + 'behaviour and one selected forecast.'
  )).toBeInTheDocument();
});

test('tabs are correctly labelled with tablist/tab semantics, defaulting to Overall model', async () => {
  mockHappyPath();
  await renderExplanation();

  expect(screen.getByRole('tablist', { name: /shap explanation scope/i })).toBeInTheDocument();
  const overallTab = screen.getByRole('tab', { name: 'Overall model' });
  const selectedTab = screen.getByRole('tab', { name: 'Selected forecast' });
  expect(overallTab).toHaveAttribute('aria-selected', 'true');
  expect(selectedTab).toHaveAttribute('aria-selected', 'false');
});

test('arrow-key navigation moves focus and activates the other tab', async () => {
  mockHappyPath();
  await renderExplanation();

  const overallTab = screen.getByRole('tab', { name: 'Overall model' });
  overallTab.focus();
  fireEvent.keyDown(overallTab, { key: 'ArrowRight' });

  const selectedTab = screen.getByRole('tab', { name: 'Selected forecast' });
  expect(selectedTab).toHaveAttribute('aria-selected', 'true');
  expect(selectedTab).toHaveFocus();
});

test('global copy describes a sampled observation set, never the selected store or "all test predictions"', async () => {
  mockHappyPath();
  await renderExplanation();

  expect(screen.getByText(/reproducible sample of 1,000 held-out test observations/i)).toBeInTheDocument();
  expect(screen.getByText('1,000 sampled test observations')).toBeInTheDocument();
  expect(screen.queryByText(/all test predictions/i)).not.toBeInTheDocument();
  expect(screen.getByText('Store selection applies to the Selected forecast tab.')).toBeInTheDocument();

  // The visible "Overall model" tabpanel itself must never mention the
  // selected store — getByRole excludes the still-hidden "Selected
  // forecast" panel by default, so this only inspects the overall panel.
  const overallPanel = screen.getByRole('tabpanel');
  expect(within(overallPanel).queryByText(/store 1/i)).not.toBeInTheDocument();
});

test('global rows render sorted, with the deterministic summary sentence built from the mocked data', async () => {
  mockHappyPath();
  await renderExplanation();

  expect(screen.getByText(
    'Promotion activity has the largest average influence on weekly predictions, '
    + 'followed by recent 12-week average sales and sales fifty-two weeks ago.'
  )).toBeInTheDocument();

  // Ranked-list accessible alternative carries the same data as the chart.
  const rankedTable = screen.getAllByRole('table')[0];
  const firstRow = within(rankedTable).getAllByRole('row')[1];
  expect(within(firstRow).getByText('Promotion activity')).toBeInTheDocument();
});

test('switching the selected store does not refetch global SHAP', async () => {
  mockHappyPath();
  const { rerender } = await renderExplanation({ selectedStore: 1 });

  const globalCallsBefore = client.get.mock.calls.filter(([url]) => url.startsWith('/shap/global')).length;
  expect(globalCallsBefore).toBe(1);

  await act(async () => {
    rerender(
      <ThemeProvider>
        <Explanation selectedStore={7} forecastType="weekly" />
      </ThemeProvider>
    );
  });

  const globalCallsAfter = client.get.mock.calls.filter(([url]) => url.startsWith('/shap/global')).length;
  expect(globalCallsAfter).toBe(1); // unchanged — global SHAP is not store-specific
  expect(client.get).toHaveBeenCalledWith(expect.stringContaining('/forecast/7'));
});

test('changing forecast type refetches global SHAP with the new type', async () => {
  mockHappyPath();
  const { rerender } = await renderExplanation({ forecastType: 'weekly' });

  client.get.mockClear();
  mockHappyPath({ forecastType: 'monthly', forecasts: MONTHLY_FORECASTS });
  await act(async () => {
    rerender(
      <ThemeProvider>
        <Explanation selectedStore={1} forecastType="monthly" />
      </ThemeProvider>
    );
  });

  expect(client.get).toHaveBeenCalledWith(expect.stringContaining('forecast_type=monthly'));
});

async function openSelectedForecastTab() {
  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name: 'Selected forecast' }));
  });
}

test('the local period navigator defaults to the latest available period', async () => {
  mockHappyPath();
  await renderExplanation();
  await openSelectedForecastTab();

  expect(screen.getByText('27 Jul 2015')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Previous period' })).toBeEnabled();
});

test('Previous/Next navigate periods and refetch local SHAP with the new period', async () => {
  mockHappyPath();
  await renderExplanation();
  await openSelectedForecastTab();

  client.get.mockClear();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
  });

  expect(screen.getByText('20 Jul 2015')).toBeInTheDocument();
  expect(client.get).toHaveBeenCalledWith(expect.stringContaining('period=2015-07-20'));
});

test('boundary period buttons are disabled at the first period', async () => {
  mockHappyPath();
  await renderExplanation();
  await openSelectedForecastTab();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); }); // 20 Jul
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous period' })); }); // 13 Jul (first)

  expect(screen.getByRole('button', { name: 'Previous period' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next period' })).toBeEnabled();
});

test('changing the selected store refetches local SHAP for the new store', async () => {
  mockHappyPath();
  const { rerender } = await renderExplanation({ selectedStore: 1 });
  await openSelectedForecastTab();

  client.get.mockClear();
  await act(async () => {
    rerender(
      <ThemeProvider>
        <Explanation selectedStore={7} forecastType="weekly" />
      </ThemeProvider>
    );
  });

  expect(client.get).toHaveBeenCalledWith(expect.stringContaining('store_id=7'));
});

test('the local request carries forecast type, store and period together', async () => {
  mockHappyPath();
  await renderExplanation();
  await openSelectedForecastTab();

  expect(client.get).toHaveBeenCalledWith(
    expect.stringMatching(/\/shap\/local\?forecast_type=weekly&store_id=1&period=2015-07-27/)
  );
});

test('the waterfall and the technical table show identical values for the same feature (no sync bug)', async () => {
  mockHappyPath();
  await renderExplanation();
  await openSelectedForecastTab();

  // Recharts' SVG bar shapes don't render in JSDOM's zero-size
  // ResponsiveContainer, so the waterfall's own accessible mobile
  // stacked-card alternative (always mounted, same underlying
  // buildWaterfall() data) is what's inspected here — it's the first
  // "Promotion activity" button in DOM order, before the technical table's
  // own mobile row cards further down the page.
  const waterfallButtons = screen.getAllByRole('button', { name: /Promotion activity/ });
  expect(waterfallButtons[0]).toHaveTextContent('+4,476');

  // Technical table row for the same feature, same rounded value — read
  // from the same single localExplanation object.
  fireEvent.click(screen.getByText('Show technical details'));
  const technicalTable = screen.getByRole('table');
  const promoRow = within(technicalTable).getByText('Promotion activity').closest('tr');
  expect(within(promoRow).getByText('+4,476')).toBeInTheDocument();
});

test('the technical table\'s full-precision tooltip uses the real minus sign, not an ASCII hyphen', async () => {
  mockHappyPath();
  await renderExplanation();
  await openSelectedForecastTab();

  fireEvent.click(screen.getByText('Show technical details'));
  const technicalTable = screen.getByRole('table');
  const negativeRow = within(technicalTable).getByText('Recent 12-week average sales').closest('tr');
  const valueCell = within(negativeRow).getByText('−5,085');
  expect(valueCell).toHaveAttribute('title', 'Full precision: −5085');
});

test('"Show all features" reveals the dynamic full feature count', async () => {
  mockHappyPath();
  await renderExplanation();
  await openSelectedForecastTab();

  fireEvent.click(screen.getByText('Show technical details'));
  expect(screen.getByText('Show all features (20)')).toBeInTheDocument();

  fireEvent.click(screen.getByText('Show all features (20)'));
  // "Competition proximity" (raw CompetitionDistance) is the 11th
  // contribution by |SHAP| — beyond the initial top-10, so it only appears
  // once the full list is expanded.
  const technicalTable = screen.getByRole('table');
  expect(within(technicalTable).getByText('Competition proximity')).toBeInTheDocument();
});

test('technical details are collapsed initially and can be expanded', async () => {
  mockHappyPath();
  await renderExplanation();
  await openSelectedForecastTab();

  expect(screen.queryByText('Hide technical details')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Show technical details'));
  expect(screen.getByText('Hide technical details')).toBeInTheDocument();
});

test('reconciliation failure shows a distinct unavailable state instead of mismatched numbers', async () => {
  // Simulate a backend inconsistency: the local response's own `period`
  // doesn't match any period in the forecast list, so no forecast can be
  // matched to derive a baseline against — the one real way reconciliation
  // can fail (see buildLocalExplanation's reconciliation-check note).
  mockHappyPath({ local: { ...LOCAL_SHAP_RESPONSE, period: '2099-01-01' } });
  await renderExplanation();
  await openSelectedForecastTab();

  expect(screen.getByText(/explanation unavailable/i)).toBeInTheDocument();
  expect(screen.queryByText('Baseline model output')).not.toBeInTheDocument();
  expect(screen.queryByText('Business interpretation')).not.toBeInTheDocument();
});

test('renders the deterministic business interpretation inside the Selected forecast panel', async () => {
  mockHappyPath();
  await renderExplanation();
  await openSelectedForecastTab();

  expect(screen.getByText('Business interpretation')).toBeInTheDocument();
  expect(screen.getByText(
    "The weekly forecast of 26,872 is 13,670 below the model's baseline output. "
    + 'Negative model contributions from recent 12-week average sales and sales fifty-two weeks ago '
    + 'reduced the prediction more than promotion activity increased it.'
  )).toBeInTheDocument();
  expect(screen.getByText(/not a business recommendation/i)).toBeInTheDocument();
});

test('does not render the AI Recommendations handoff when no page navigator is supplied', async () => {
  mockHappyPath();
  await renderExplanation();
  await openSelectedForecastTab();

  expect(screen.queryByRole('button', { name: /open ai recommendations/i })).not.toBeInTheDocument();
});

test('the AI Recommendations handoff navigates to the agent page, preserving the shared store/forecast-type state', async () => {
  mockHappyPath();
  const setActivePage = jest.fn();
  await renderExplanation({ setActivePage });
  await openSelectedForecastTab();

  expect(screen.getByRole('button', { name: 'Open AI Recommendations' })).toBeInTheDocument();
  expect(screen.queryByText(/not the historical period currently selected/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /open ai recommendations/i }));
  expect(setActivePage).toHaveBeenCalledWith('agent');
});

test('on a historical period, the handoff clarifies that AI Recommendations use the latest forecast instead', async () => {
  mockHappyPath();
  const setActivePage = jest.fn();
  await renderExplanation({ setActivePage });
  await openSelectedForecastTab();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
  });

  expect(screen.getByRole('button', { name: 'Open latest AI Recommendations' })).toBeInTheDocument();
  expect(screen.getByText(
    'AI Recommendations use the latest available forecast, not the historical period currently selected.'
  )).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Open latest AI Recommendations' }));
  expect(setActivePage).toHaveBeenCalledWith('agent');
});

test('never renders an actual-sales value, and never issues a POST request', async () => {
  mockHappyPath();
  await renderExplanation();
  await openSelectedForecastTab();

  expect(screen.queryByText('24,500')).not.toBeInTheDocument();
  expect(screen.queryByText('25,800')).not.toBeInTheDocument();
  expect(client.post).not.toHaveBeenCalled();
});

test('shows an error banner with a working retry on global SHAP failure', async () => {
  client.get.mockImplementation((url) => {
    if (url.startsWith('/shap/global')) return Promise.reject(new Error('network down'));
    if (url.startsWith('/forecast/')) return Promise.resolve({ data: { forecasts: WEEKLY_FORECASTS } });
    return Promise.resolve({ data: LOCAL_SHAP_RESPONSE });
  });
  await renderExplanation();

  expect(screen.getByRole('alert')).toBeInTheDocument();

  client.get.mockImplementation((url) => {
    if (url.startsWith('/shap/global')) return Promise.resolve({ data: { features: GLOBAL_WEEKLY } });
    if (url.startsWith('/forecast/')) return Promise.resolve({ data: { forecasts: WEEKLY_FORECASTS } });
    return Promise.resolve({ data: LOCAL_SHAP_RESPONSE });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  });

  expect(screen.getByText(/reproducible sample of 1,000/i)).toBeInTheDocument();
});
