import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Agent, {
  formatFullDate, formatWeeklyPeriod, formatMonthlyPeriod, formatSelectedPeriod,
  formatRounded, formatSigned, formatTimestamp, resolveEvidenceRef,
} from '../pages/agent/Agent';
import { ThemeProvider } from '../context/ThemeContext';
import client from '../api/client';

// Same automock approach as the rest of this project's tests (see
// Login.test.jsx for why an inline mock factory can't be used here).
jest.mock('../api/client');

const DRIVER = (feature, readable, shap) => ({ feature, readable_feature: readable, shap_value: shap });

const EVIDENCE = {
  store_id: 1,
  forecast_type: 'weekly',
  period: '2015-07-27',
  predicted_sales: 26872.193,
  baseline_model_output: 22480.4934,
  net_shap_adjustment: 4391.6996,
  top_positive_drivers: [DRIVER('PromoDays', 'Promotion activity', 4475.5996)],
  top_negative_drivers: [DRIVER('rolling_mean_12', 'Recent 12-week average', -5084.6997)],
  shap_drivers: [
    DRIVER('PromoDays', 'Promotion activity', 4475.5996),
    DRIVER('rolling_mean_12', 'Recent 12-week average', -5084.6997),
  ],
  shap_feature_count: 45,
  reconciliation_ok: true,
  forecast_model: 'XGBoost',
  explanation_source: 'Precomputed local SHAP',
};

const RECOMMENDATION_RESPONSE = {
  store_id: 1,
  period: '2015-07-27',
  forecast_type: 'weekly',
  predicted_sales: 26872.193,
  recommendations: {
    staffing: {
      recommendation: 'Consider reviewing rota coverage for the forecast period.',
      detail: 'The forecast suggests demand above baseline, driven mainly by promotion activity.',
      urgency: 'medium',
      evidence_refs: ['predicted_sales', 'shap:PromoDays', 'shap:not_a_real_feature'],
      caution: 'This does not account for actual staff availability.',
    },
    stock: {
      recommendation: 'This may justify checking store-level stock readiness.',
      detail: 'Recent 12-week average sales pulled the forecast down relative to baseline.',
      urgency: 'low',
      evidence_refs: ['shap:rolling_mean_12'],
      caution: 'Product-level demand is not available in this dataset.',
    },
    promotions: {
      recommendation: 'Consider reviewing current promotion timing.',
      detail: 'The modelled contribution of promotion activity is the largest positive driver.',
      urgency: 'low',
      evidence_refs: ['shap:PromoDays'],
      caution: 'SHAP contribution is not evidence of a causal promotion effect.',
    },
    summary: 'Predicted demand is above the model baseline, mainly reflecting promotion activity.',
    limitations: ['Product-level demand is not available.', 'Employee schedules are not available.'],
  },
  generated_at: '2025-07-20T10:15:00Z',
  provider: 'Anthropic',
  model: 'claude-opus-5',
  prompt_version: 'v2',
};

function mockHappyPath({ evidence = EVIDENCE } = {}) {
  client.get.mockImplementation((url) => {
    if (url.startsWith('/agent/recommend/evidence')) return Promise.resolve({ data: evidence });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

async function renderAgent(props = {}) {
  const utils = render(
    <ThemeProvider>
      <Agent selectedStore={1} forecastType="weekly" setActivePage={jest.fn()} {...props} />
    </ThemeProvider>
  );
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  if (!('clipboard' in navigator)) {
    Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
  }
  navigator.clipboard.writeText = jest.fn().mockResolvedValue(undefined);
  if (!global.URL.createObjectURL) global.URL.createObjectURL = jest.fn();
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = jest.fn();
  jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
  jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

// ---- Pure formatter/resolver unit tests ----

describe('formatters', () => {
  test('formatFullDate / formatWeeklyPeriod / formatMonthlyPeriod use readable, non-ISO wording', () => {
    expect(formatFullDate('2015-07-27')).toBe('27 July 2015');
    expect(formatWeeklyPeriod('2015-07-27')).toBe('Week beginning 27 July 2015');
    expect(formatMonthlyPeriod('2015-07-01')).toBe('July 2015');
  });

  test('formatSelectedPeriod dispatches on forecast type', () => {
    expect(formatSelectedPeriod('2015-07-27', 'weekly')).toBe('Week beginning 27 July 2015');
    expect(formatSelectedPeriod('2015-07-01', 'monthly')).toBe('July 2015');
  });

  test('formatRounded rounds and uses the real minus sign for negatives', () => {
    expect(formatRounded(26872.193)).toBe('26,872');
    expect(formatRounded(-5084.6997)).toBe('−5,085');
  });

  test('formatSigned prefixes a sign and uses the real minus sign', () => {
    expect(formatSigned(4475.5996)).toBe('+4,476');
    expect(formatSigned(-5084.6997)).toBe('−5,085');
    expect(formatSigned(0)).toBe('0');
  });

  test('formatTimestamp renders a readable date/time, not a raw ISO string', () => {
    const out = formatTimestamp('2025-07-20T10:15:00Z');
    expect(out).not.toContain('T10:15:00Z');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('resolveEvidenceRef', () => {
  test('resolves predicted_sales and shap:<feature> refs to trusted evidence values', () => {
    expect(resolveEvidenceRef('predicted_sales', EVIDENCE)).toEqual({ label: 'Predicted sales', value: '26,872' });
    expect(resolveEvidenceRef('shap:PromoDays', EVIDENCE)).toEqual({ label: 'Promotion activity', value: '+4,476' });
  });

  test('an unknown or fabricated evidence reference resolves to null and is never rendered', () => {
    expect(resolveEvidenceRef('shap:not_a_real_feature', EVIDENCE)).toBeNull();
    expect(resolveEvidenceRef('made_up_ref', EVIDENCE)).toBeNull();
  });
});

// ---- Evidence preview ----

test('the evidence preview shows the exact store, forecast type, and latest period — never "most recent period"', async () => {
  mockHappyPath();
  await renderAgent();

  expect(screen.getByText('Store 1')).toBeInTheDocument();
  expect(screen.getByText('Weekly')).toBeInTheDocument();
  expect(screen.getByText('Week beginning 27 July 2015')).toBeInTheDocument();
  expect(screen.getByText('26,872')).toBeInTheDocument();
  expect(screen.queryByText(/most recent period/i)).not.toBeInTheDocument();
  expect(screen.getByText('Latest forecast only')).toBeInTheDocument();
});

test('no actual sales figure is ever displayed on the page', async () => {
  mockHappyPath();
  await renderAgent();
  expect(screen.queryByText(/actual sales/i)).not.toBeInTheDocument();
});

// ---- Generation gating ----

test('generation is disabled while evidence is loading, and never fires automatically', async () => {
  let resolveEvidence;
  client.get.mockImplementation((url) => {
    if (url.startsWith('/agent/recommend/evidence')) return new Promise(res => { resolveEvidence = res; });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  await renderAgent();

  const button = screen.getByRole('button', { name: /generate ai recommendations/i });
  expect(button).toBeDisabled();
  expect(client.post).not.toHaveBeenCalled();

  await act(async () => { resolveEvidence({ data: EVIDENCE }); });
  expect(button).toBeEnabled();
  expect(client.post).not.toHaveBeenCalled();
});

test('generation is disabled when forecast/SHAP evidence cannot be reconciled', async () => {
  mockHappyPath({ evidence: { ...EVIDENCE, reconciliation_ok: false } });
  await renderAgent();
  expect(screen.getByRole('button', { name: /generate ai recommendations/i })).toBeDisabled();
  expect(screen.getByText(/could not be reconciled/i)).toBeInTheDocument();
});

test('clicking generate is user-initiated and sends no actual-sales terms in the request', async () => {
  mockHappyPath();
  client.post.mockResolvedValue({ data: RECOMMENDATION_RESPONSE });
  await renderAgent();
  await waitFor(() => expect(screen.getByRole('button', { name: /generate ai recommendations/i })).toBeEnabled());

  expect(client.post).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate ai recommendations/i }));
  });

  expect(client.post).toHaveBeenCalledTimes(1);
  const [url, body] = client.post.mock.calls[0];
  expect(url).toBe('/agent/recommend?store_id=1&forecast_type=weekly');
  expect(url).not.toMatch(/actual/i);
  expect(body).toBeUndefined();
  expect(await screen.findByText(/Predicted demand is above the model baseline/)).toBeInTheDocument();
});

test('a slow, superseded request never overwrites the result from a newer context', async () => {
  let resolveFirst;
  mockHappyPath();
  client.post.mockImplementation(() => new Promise(res => { resolveFirst = res; }));
  const { rerender } = await renderAgent();
  await waitFor(() => expect(screen.getByRole('button', { name: /generate ai recommendations/i })).toBeEnabled());

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate ai recommendations/i }));
  });

  // Store changes mid-flight — this must invalidate the in-flight request.
  await act(async () => {
    rerender(
      <ThemeProvider>
        <Agent selectedStore={2} forecastType="weekly" setActivePage={jest.fn()} />
      </ThemeProvider>
    );
  });

  await act(async () => {
    resolveFirst({ data: { ...RECOMMENDATION_RESPONSE, store_id: 1 } });
  });

  expect(screen.queryByText(/Predicted demand is above the model baseline/)).not.toBeInTheDocument();
});

// ---- Structured result rendering ----

test('renders staffing, stock, and promotion cards with evidence and a caution, and resolves evidence_refs to trusted values', async () => {
  mockHappyPath();
  client.post.mockResolvedValue({ data: RECOMMENDATION_RESPONSE });
  await renderAgent();
  await waitFor(() => expect(screen.getByRole('button', { name: /generate ai recommendations/i })).toBeEnabled());

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate ai recommendations/i }));
  });

  expect(await screen.findByText('Staffing')).toBeInTheDocument();
  expect(screen.getByText('Stock')).toBeInTheDocument();
  expect(screen.getByText('Promotion')).toBeInTheDocument();
  expect(screen.getByText(/This does not account for actual staff availability/)).toBeInTheDocument();

  // Known evidence_refs resolve to trusted labels...
  expect(screen.getAllByText('Predicted sales').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Promotion activity').length).toBeGreaterThan(0);
  // ...an unknown/fabricated ref is never rendered anywhere on the page.
  expect(screen.queryByText(/not_a_real_feature/)).not.toBeInTheDocument();

  // Human-review, latest-forecast-only, and metadata are all visible.
  expect(screen.getAllByText(/A manager should review operational data/).length).toBeGreaterThan(0);
});

test('shows a limitation instead of fabricated detail, and renders the risks/uncertainties section', async () => {
  mockHappyPath();
  client.post.mockResolvedValue({ data: RECOMMENDATION_RESPONSE });
  await renderAgent();
  await waitFor(() => expect(screen.getByRole('button', { name: /generate ai recommendations/i })).toBeEnabled());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate ai recommendations/i }));
  });

  expect(await screen.findByText('Risks and uncertainties')).toBeInTheDocument();
  expect(screen.getByText('Product-level demand is not available.')).toBeInTheDocument();
});

// ---- Error / retry ----

test('a failed generation shows a manager-readable error with retry, not a stack trace', async () => {
  mockHappyPath();
  client.post.mockRejectedValueOnce({ response: { data: { detail: 'Could not reach the Claude API.' } } });
  await renderAgent();
  await waitFor(() => expect(screen.getByRole('button', { name: /generate ai recommendations/i })).toBeEnabled());

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate ai recommendations/i }));
  });

  expect(await screen.findByText('Could not reach the Claude API.')).toBeInTheDocument();
  expect(screen.queryByText(/Traceback/i)).not.toBeInTheDocument();

  client.post.mockResolvedValueOnce({ data: RECOMMENDATION_RESPONSE });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  });
  expect(await screen.findByText(/Predicted demand is above the model baseline/)).toBeInTheDocument();
});

test('the evidence-loading error state offers a retry that recovers', async () => {
  client.get
    .mockImplementationOnce(() => Promise.reject(new Error('network down')))
    .mockImplementation((url) => {
      if (url.startsWith('/agent/recommend/evidence')) return Promise.resolve({ data: EVIDENCE });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
  await renderAgent();

  expect(screen.getByText(/Could not load forecast and SHAP evidence/i)).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  });

  expect(await screen.findByText('Store 1')).toBeInTheDocument();
});

// ---- Context changes clear stale results ----

test('changing store clears a prior recommendation result', async () => {
  mockHappyPath();
  client.post.mockResolvedValue({ data: RECOMMENDATION_RESPONSE });
  const { rerender } = await renderAgent();
  await waitFor(() => expect(screen.getByRole('button', { name: /generate ai recommendations/i })).toBeEnabled());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate ai recommendations/i }));
  });
  expect(await screen.findByText(/Predicted demand is above the model baseline/)).toBeInTheDocument();

  await act(async () => {
    rerender(
      <ThemeProvider>
        <Agent selectedStore={2} forecastType="weekly" setActivePage={jest.fn()} />
      </ThemeProvider>
    );
  });

  expect(screen.queryByText(/Predicted demand is above the model baseline/)).not.toBeInTheDocument();
});

test('changing forecast type clears a prior recommendation result', async () => {
  mockHappyPath();
  client.post.mockResolvedValue({ data: RECOMMENDATION_RESPONSE });
  const { rerender } = await renderAgent();
  await waitFor(() => expect(screen.getByRole('button', { name: /generate ai recommendations/i })).toBeEnabled());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate ai recommendations/i }));
  });
  expect(await screen.findByText(/Predicted demand is above the model baseline/)).toBeInTheDocument();

  await act(async () => {
    rerender(
      <ThemeProvider>
        <Agent selectedStore={1} forecastType="monthly" setActivePage={jest.fn()} />
      </ThemeProvider>
    );
  });

  expect(screen.queryByText(/Predicted demand is above the model baseline/)).not.toBeInTheDocument();
});

// ---- Post-generation controls ----

test('regenerate, copy, and download all work after a successful generation', async () => {
  mockHappyPath();
  client.post.mockResolvedValue({ data: RECOMMENDATION_RESPONSE });
  await renderAgent();
  await waitFor(() => expect(screen.getByRole('button', { name: /generate ai recommendations/i })).toBeEnabled());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate ai recommendations/i }));
  });
  expect(await screen.findByText(/Predicted demand is above the model baseline/)).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^regenerate$/i }));
  });
  expect(client.post).toHaveBeenCalledTimes(2);

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /copy recommendations/i }));
  });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('AI-generated decision-support suggestions'));

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /download recommendations/i }));
  });
  expect(URL.createObjectURL).toHaveBeenCalled();
});

test('the pipeline strip lets a manager navigate to Forecast/Explanation and back from a generated result', async () => {
  mockHappyPath();
  client.post.mockResolvedValue({ data: RECOMMENDATION_RESPONSE });
  const setActivePage = jest.fn();
  await renderAgent({ setActivePage });

  fireEvent.click(screen.getByRole('button', { name: /forecast — xgboost/i }));
  expect(setActivePage).toHaveBeenCalledWith('forecast');

  fireEvent.click(screen.getByRole('button', { name: /explanation — shap/i }));
  expect(setActivePage).toHaveBeenCalledWith('explanation');

  expect(screen.getByText(/ai recommendations — claude/i)).toHaveAttribute('aria-current', 'step');

  await waitFor(() => expect(screen.getByRole('button', { name: /generate ai recommendations/i })).toBeEnabled());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate ai recommendations/i }));
  });
  await screen.findByText(/Predicted demand is above the model baseline/);

  fireEvent.click(screen.getByRole('button', { name: /return to explanation/i }));
  expect(setActivePage).toHaveBeenCalledWith('explanation');
});

test('the transparency section reports provider, model, prompt version, and human-review requirement without exposing secrets', async () => {
  mockHappyPath();
  client.post.mockResolvedValue({ data: RECOMMENDATION_RESPONSE });
  await renderAgent();
  await waitFor(() => expect(screen.getByRole('button', { name: /generate ai recommendations/i })).toBeEnabled());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate ai recommendations/i }));
  });
  await screen.findByText(/Predicted demand is above the model baseline/);

  fireEvent.click(screen.getByText(/about these ai recommendations/i));

  expect(screen.getByText('Anthropic')).toBeInTheDocument();
  expect(screen.getByText('claude-opus-5')).toBeInTheDocument();
  expect(screen.getByText('v2')).toBeInTheDocument();
  expect(screen.getAllByText('Yes').length).toBeGreaterThan(0);
  expect(screen.getAllByText('No').length).toBeGreaterThan(0);
  expect(screen.queryByText(/sk-ant/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/ANTHROPIC_API_KEY/i)).not.toBeInTheDocument();
});
