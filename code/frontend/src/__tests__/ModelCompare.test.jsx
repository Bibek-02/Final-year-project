import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ModelCompare from '../pages/compare/ModelCompare';
import { ThemeProvider } from '../context/ThemeContext';
import client from '../api/client';

// Same automock approach as the rest of this project's tests (see
// Login.test.jsx for why an inline mock factory can't be used here).
jest.mock('../api/client');

const WEEKLY_COMPARISON = [
  { Model: 'XGBoost', 'Forecast Type': 'Weekly', MAE: 2173.826, RMSE: 3181.982, MAPE: 5.334, RMSPE: 7.362 },
  { Model: 'Random Forest', 'Forecast Type': 'Weekly', MAE: 2760.274, RMSE: 4164.14, MAPE: 6.674, RMSPE: 9.627 },
  { Model: 'Moving Average 12 Weeks', 'Forecast Type': 'Weekly', MAE: 6485.035, RMSE: 7511.622, MAPE: 16.499, RMSPE: 19.266 },
];

const MONTHLY_COMPARISON = [
  { Model: 'XGBoost', 'Forecast Type': 'Monthly', MAE: 8462.312, RMSE: 11351.831, MAPE: 4.729, RMSPE: 6.283 },
  { Model: 'Random Forest', 'Forecast Type': 'Monthly', MAE: 9234.614, RMSE: 12643.827, MAPE: 5.224, RMSPE: 7.987 },
  { Model: 'Moving Average 6 Months', 'Forecast Type': 'Monthly', MAE: 12816.886, RMSE: 17083.914, MAPE: 7.109, RMSPE: 9.717 },
];

const BEST_WEEKLY  = { forecast_type: 'weekly',  best_model: 'XGBoost', MAE: 2173.826,  RMSE: 3181.982,  MAPE: 5.334, RMSPE: 7.362 };
const BEST_MONTHLY = { forecast_type: 'monthly', best_model: 'XGBoost', MAE: 8462.312,  RMSE: 11351.831, MAPE: 4.729, RMSPE: 6.283 };

const METADATA = {
  project_title: 'Explainable Sales Forecasting with AI-Generated Retail Recommendations: A Rossmann Case Study',
  dataset: 'Rossmann Store Sales',
  forecasting: {
    weekly: {
      selected_model: 'XGBoost', target: 'WeeklySales', feature_count: 45, validation_mae: 2642.298,
      test_metrics: { MAE: 2173.826, RMSE: 3181.982, MAPE: 5.334, RMSPE: 7.362 },
    },
    monthly: {
      selected_model: 'XGBoost', target: 'MonthlySales', feature_count: 41, validation_mae: 9352.965,
      test_metrics: { MAE: 8462.312, RMSE: 11351.831, MAPE: 4.729, RMSPE: 6.283 },
    },
  },
  model_selection: { primary_metric: 'Validation MAE', test_set_use: 'Final evaluation only' },
  explainability: ['XGBoost feature importance', 'Global SHAP importance', 'Local SHAP explanations'],
  architecture: { artifact_first: true, runtime_retraining: false, backend: 'FastAPI', frontend: 'React', ai_recommendations: true },
  dss_output: { contains_actual_sales: false, contains_predicted_sales: true, contains_shap_factors: true, contains_forecast_summary: true },
};

const WEEKLY_PERIODS = [
  '2015-05-04', '2015-05-11', '2015-05-18', '2015-05-25',
  '2015-06-01', '2015-06-08', '2015-06-15', '2015-06-22', '2015-06-29',
  '2015-07-06', '2015-07-13', '2015-07-20', '2015-07-27',
];
const MONTHLY_PERIODS = ['2015-05-01', '2015-06-01', '2015-07-01'];

function mockForecast(periods, forecastType) {
  return {
    store_id: 1,
    forecast_type: forecastType,
    record_count: periods.length,
    forecasts: periods.map(period => ({ period, actual_sales: 10000, prediction: 10000 })),
  };
}

function mockHappyPath() {
  client.get.mockImplementation((url) => {
    if (url.startsWith('/models/compare?forecast_type=weekly'))  return Promise.resolve({ data: { filter: 'weekly',  record_count: 3, comparison: WEEKLY_COMPARISON } });
    if (url.startsWith('/models/compare?forecast_type=monthly')) return Promise.resolve({ data: { filter: 'monthly', record_count: 3, comparison: MONTHLY_COMPARISON } });
    if (url.startsWith('/models/best?forecast_type=weekly'))     return Promise.resolve({ data: BEST_WEEKLY });
    if (url.startsWith('/models/best?forecast_type=monthly'))    return Promise.resolve({ data: BEST_MONTHLY });
    if (url.startsWith('/metadata'))                             return Promise.resolve({ data: METADATA });
    if (url.startsWith('/forecast/1?forecast_type=weekly'))      return Promise.resolve({ data: mockForecast(WEEKLY_PERIODS, 'weekly') });
    if (url.startsWith('/forecast/1?forecast_type=monthly'))     return Promise.resolve({ data: mockForecast(MONTHLY_PERIODS, 'monthly') });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

async function renderPage(props = {}) {
  const utils = render(
    <ThemeProvider>
      <ModelCompare selectedStore={1} {...props} />
    </ThemeProvider>
  );
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders the Model Evaluation header', async () => {
  mockHappyPath();
  await renderPage();
  expect(screen.getByRole('heading', { name: 'Model Evaluation' })).toBeInTheDocument();
});

test('loads and displays the model comparison data for the default (weekly) frequency', async () => {
  mockHappyPath();
  await renderPage();

  expect(screen.getAllByText('XGBoost').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Random Forest').length).toBeGreaterThan(0);
  // "2,174" (weekly XGBoost MAE) appears in both the summary card and the table.
  expect(screen.getAllByText('2,174').length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText('5.33%').length).toBeGreaterThan(0); // weekly XGBoost MAPE
});

test('the weekly/monthly toggle changes the displayed data', async () => {
  mockHappyPath();
  await renderPage();

  expect(screen.getByText('45')).toBeInTheDocument(); // weekly feature count
  expect(screen.getAllByText('2,174').length).toBeGreaterThan(0); // weekly MAE

  fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }));

  expect(screen.getByText('41')).toBeInTheDocument(); // monthly feature count
  expect(screen.getAllByText('8,462').length).toBeGreaterThan(0); // monthly XGBoost MAE
  expect(screen.queryByText('2,174')).not.toBeInTheDocument(); // weekly MAE no longer shown
});

test('shows XGBoost as the selected model, with a "Selected for DSS" badge rather than "perfect"', async () => {
  mockHappyPath();
  await renderPage();

  expect(screen.getByText('Selected model')).toBeInTheDocument();
  expect(screen.getAllByText('XGBoost').length).toBeGreaterThan(0);
  expect(screen.getByText('Selected for DSS')).toBeInTheDocument();
  expect(screen.queryByText(/perfect/i)).not.toBeInTheDocument();
});

test('shows "Lower values are better" helper text', async () => {
  mockHappyPath();
  await renderPage();
  expect(screen.getByText('Lower values are better for all metrics.')).toBeInTheDocument();
});

test('shows the metric-meaning section explaining MAE/RMSE/MAPE/RMSPE', async () => {
  mockHappyPath();
  await renderPage();

  expect(screen.getByText('What these metrics mean')).toBeInTheDocument();
  expect(screen.getByText(/Average absolute difference between predicted and actual sales/)).toBeInTheDocument();
  expect(screen.getByText(/penalises larger errors more strongly/)).toBeInTheDocument();
  expect(screen.getByText(/gives more weight to larger percentage mistakes/)).toBeInTheDocument();
});

test('shows the evaluation scope and limitations section', async () => {
  mockHappyPath();
  await renderPage();

  expect(screen.getByText('Evaluation scope and limitations')).toBeInTheDocument();
  expect(screen.getByText('Historical held-out Rossmann data only.')).toBeInTheDocument();
  expect(screen.getByText('No live future forecasting in this deployed artefact.')).toBeInTheDocument();
  expect(screen.getByText('No backend retraining.')).toBeInTheDocument();
  expect(screen.getByText(/Monthly evaluation uses 3 held-out periods, fewer than the 13 used for weekly/)).toBeInTheDocument();
});

test('never describes MAPE (or anything else) as "accuracy"', async () => {
  mockHappyPath();
  await renderPage();
  expect(screen.queryByText(/accuracy/i)).not.toBeInTheDocument();
});

test('handoff buttons call setActivePage for Forecast and Explanation when supplied', async () => {
  mockHappyPath();
  const setActivePage = jest.fn();
  await renderPage({ setActivePage });

  fireEvent.click(screen.getByRole('button', { name: /view forecast analysis/i }));
  expect(setActivePage).toHaveBeenCalledWith('forecast');

  fireEvent.click(screen.getByRole('button', { name: /view forecast explanation/i }));
  expect(setActivePage).toHaveBeenCalledWith('explanation');
});

test('handoff buttons are not rendered when setActivePage is not supplied', async () => {
  mockHappyPath();
  await renderPage();
  expect(screen.queryByRole('button', { name: /view forecast analysis/i })).not.toBeInTheDocument();
});

test('the held-out date range and period count reflect the loaded forecast artifact, not hard-coded text', async () => {
  mockHappyPath();
  await renderPage();

  expect(screen.getByText('Held-out period count')).toBeInTheDocument();
  expect(screen.getByText('13')).toBeInTheDocument();
  expect(screen.getByText(/4 May 2015.*27 Jul 2015/)).toBeInTheDocument();
});

test('clarifies that these results are global/artifact-level, not selected-store results', async () => {
  mockHappyPath();
  await renderPage();
  expect(screen.getByText(/not selected-store results/i)).toBeInTheDocument();
});

test('shows a retryable error banner when data loading fails', async () => {
  client.get.mockRejectedValue(new Error('network down'));
  await renderPage();
  expect(screen.getByText('Failed to load model evaluation data.')).toBeInTheDocument();

  mockHappyPath();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Model Evaluation' })).toBeInTheDocument());
});
