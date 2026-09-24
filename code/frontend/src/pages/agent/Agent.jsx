import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot, Lightbulb, Users, Package, Tag, TrendingUp, Search, ArrowRight, ArrowLeft,
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Copy, Download,
  RefreshCw, ShieldAlert, Info,
} from 'lucide-react';
import client from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../hooks/useToast';
import PageHeader from '../../components/PageHeader';
import AlertBanner from '../../components/AlertBanner';
import EmptyState from '../../components/EmptyState';
import { SkeletonTable } from '../../components/Skeleton';
import ToastStack from '../../components/Toast';

// ---- Formatting helpers — pure, exported for direct unit testing ----

const MINUS = '−'; // real minus sign (U+2212), not the ASCII hyphen Number.toFixed produces
const FULL_DATE_FMT  = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const MONTH_YEAR_FMT = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const TIMESTAMP_FMT  = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function toDate(period) {
  return new Date(`${period}T00:00:00`);
}

export function formatFullDate(period) {
  return FULL_DATE_FMT.format(toDate(period));
}

export function formatWeeklyPeriod(period) {
  return `Week beginning ${formatFullDate(period)}`;
}

export function formatMonthlyPeriod(period) {
  return MONTH_YEAR_FMT.format(toDate(period));
}

export function formatSelectedPeriod(period, forecastType) {
  if (!period) return '';
  return forecastType === 'weekly' ? formatWeeklyPeriod(period) : formatMonthlyPeriod(period);
}

export function formatRounded(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  return rounded < 0 ? `${MINUS}${Math.abs(rounded).toLocaleString('en-US')}` : rounded.toLocaleString('en-US');
}

export function formatSigned(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  if (rounded === 0) return '0';
  return rounded > 0 ? `+${rounded.toLocaleString('en-US')}` : `${MINUS}${Math.abs(rounded).toLocaleString('en-US')}`;
}

export function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return TIMESTAMP_FMT.format(d);
}

// Resolves a Claude-cited evidence_ref back to a trusted, backend-supplied
// value — Claude's own reproduced numbers are never rendered as evidence.
// Unknown refs (already dropped server-side, but checked again here as a
// second line of defence) resolve to null and are simply not rendered.
export function resolveEvidenceRef(ref, evidence) {
  if (!ref || !evidence) return null;
  if (ref === 'predicted_sales') {
    return { label: 'Predicted sales', value: formatRounded(evidence.predicted_sales) };
  }
  if (ref === 'positive_factors') {
    return { label: 'Deterministic positive-factor summary', value: null };
  }
  if (ref === 'negative_factors') {
    return { label: 'Deterministic negative-factor summary', value: null };
  }
  if (ref.startsWith('shap:')) {
    const rawFeature = ref.slice('shap:'.length);
    const driver = (evidence.shap_drivers || []).find(d => d.feature === rawFeature);
    if (!driver) return null;
    return { label: driver.readable_feature, value: formatSigned(driver.shap_value) };
  }
  return null;
}

const DATA_LIMITATIONS = [
  'Product-level demand',
  'Current stock quantities',
  'Product availability',
  'Employee schedules',
  'Required staffing ratios',
  'Labour costs',
  'Product costs',
  'Profit margins',
  'Promotion profitability',
  'Local events not represented in the dataset',
];

const URGENCY_CONFIG = {
  high  : { classes: 'bg-red-100 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30',     Icon: AlertCircle,   iconClass: 'text-status-critical dark:text-red-400' },
  medium: { classes: 'bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30', Icon: AlertTriangle, iconClass: 'text-status-warning dark:text-amber-400'  },
  low   : { classes: 'bg-green-100 text-green-700 border border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/30', Icon: CheckCircle2,  iconClass: 'text-status-good dark:text-green-400'     },
};

const RECOMMENDATION_CARDS = [
  { key: 'staffing',   label: 'Staffing',   Icon: Users,   badge: 'bg-indigo-600' },
  { key: 'stock',      label: 'Stock',      Icon: Package, badge: 'bg-semantic-success' },
  { key: 'promotions', label: 'Promotion',  Icon: Tag,     badge: 'bg-semantic-warning' },
];

// Secondary (non-primary) action button — this codebase has no `.btn-secondary`
// class, so this mirrors the bordered-button idiom used elsewhere for
// secondary actions, kept local to this page per its established convention.
function ActionButton({ icon: Icon, children, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1.5 text-sm font-semibold px-4 min-h-[44px]
                 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200
                 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50
                 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2
                 focus-visible:ring-indigo-400"
    >
      <Icon size={15} aria-hidden="true" />
      {children}
    </button>
  );
}

// Restrained, clickable pipeline strip: Forecast and Explanation are real
// navigation (setActivePage), AI Recommendations is the current, inert step.
function PipelineNav({ setActivePage }) {
  return (
    <nav aria-label="Recommendation pipeline" className="flex items-center gap-2 text-xs text-gray-400 mb-6 flex-wrap">
      <button
        type="button"
        onClick={() => setActivePage?.('forecast')}
        disabled={!setActivePage}
        className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:text-gray-600 dark:hover:text-gray-200
                   hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:hover:bg-transparent"
      >
        <TrendingUp size={13} /> Forecast — XGBoost
      </button>
      <ArrowRight size={12} className="flex-shrink-0" />
      <button
        type="button"
        onClick={() => setActivePage?.('explanation')}
        disabled={!setActivePage}
        className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:text-gray-600 dark:hover:text-gray-200
                   hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:hover:bg-transparent"
      >
        <Search size={13} /> Explanation — SHAP
      </button>
      <ArrowRight size={12} className="flex-shrink-0" />
      <span aria-current="step" className="flex items-center gap-1.5 px-1.5 py-1 font-semibold text-indigo-600 dark:text-indigo-400">
        <Bot size={13} /> AI Recommendations — Claude
      </span>
    </nav>
  );
}

// Key/value evidence grid — CSS grid on desktop, stacked rows on mobile via
// the same grid collapsing to one column (no horizontal table/scroll).
function EvidenceRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-gray-100
                    dark:border-gray-700/60 last:border-0">
      <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-sm font-semibold text-gray-800 dark:text-gray-100 text-right tabular-nums">{value}</dd>
    </div>
  );
}

function EvidencePreview({ evidence, loading, error, onRetry, selectedPeriod, forecastType }) {
  return (
    <div className="card mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Search size={16} className="text-indigo-600 dark:text-indigo-400" />
        <h2 className="card-title mb-0">Evidence used for this recommendation</h2>
      </div>
      <p className="text-secondary text-xs mb-4">
        {selectedPeriod
          ? `Recommendations use the forecast for ${formatSelectedPeriod(selectedPeriod, forecastType)} — the period selected before opening this page.`
          : 'Recommendations use the latest available forecast for the selected store and forecast type.'}
      </p>

      {loading && <SkeletonTable rows={8} cols={2} />}

      {!loading && error && (
        <AlertBanner variant="error" onRetry={onRetry}>{error}</AlertBanner>
      )}

      {!loading && !error && evidence?.notAvailable && (
        <EmptyState
          title="No evidence available for this period"
          message={evidence.detail}
        />
      )}

      {!loading && !error && evidence && !evidence.notAvailable && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8">
          <EvidenceRow label="Store" value={`Store ${evidence.store_id}`} />
          <EvidenceRow label="Forecast type" value={evidence.forecast_type === 'weekly' ? 'Weekly' : 'Monthly'} />
          <EvidenceRow label="Forecast period" value={formatSelectedPeriod(evidence.period, evidence.forecast_type)} />
          <EvidenceRow label="Predicted sales" value={formatRounded(evidence.predicted_sales)} />
          <EvidenceRow label="Forecast model" value={evidence.forecast_model} />
          <EvidenceRow
            label="Strongest increase"
            value={evidence.top_positive_drivers[0]
              ? `${evidence.top_positive_drivers[0].readable_feature}, ${formatSigned(evidence.top_positive_drivers[0].shap_value)}`
              : 'None'}
          />
          <EvidenceRow
            label="Strongest decrease"
            value={evidence.top_negative_drivers[0]
              ? `${evidence.top_negative_drivers[0].readable_feature}, ${formatSigned(evidence.top_negative_drivers[0].shap_value)}`
              : 'None'}
          />
          <EvidenceRow label="Explanation source" value={evidence.explanation_source} />
        </dl>
      )}

      {!loading && !error && evidence && !evidence.notAvailable && !evidence.reconciliation_ok && (
        <div className="mt-4">
          <AlertBanner variant="warning" onRetry={onRetry}>
            Forecast and SHAP evidence could not be reconciled for this period. Generation is disabled
            until this is resolved.
          </AlertBanner>
        </div>
      )}
    </div>
  );
}

function LimitationsDisclosure() {
  return (
    <details className="mt-4 group">
      <summary
        className="cursor-pointer flex items-center gap-1.5 text-xs font-semibold text-indigo-600
                   hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded
                   min-h-[44px] w-fit"
      >
        <ChevronDown size={14} className="group-open:hidden" />
        <ChevronUp size={14} className="hidden group-open:block" />
        Data limitations
      </summary>
      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        <p className="mb-2">The Rossmann forecast evidence does not include:</p>
        <ul className="list-disc list-inside space-y-0.5 mb-2">
          {DATA_LIMITATIONS.map(item => <li key={item}>{item}</li>)}
        </ul>
        <p>
          Because of this, recommendations do not include exact employee numbers, exact shift schedules,
          exact product order quantities, specific product or SKU recommendations, financial return
          estimates, or claims that a promotion caused a change in sales or that an outcome is guaranteed.
        </p>
      </div>
    </details>
  );
}

function GenerationCard({ selectedStore, forecastType, evidence, evidenceLoading, evidenceError, loadingRec, onGenerate }) {
  const canGenerate = !evidenceLoading && !evidenceError && !!evidence?.reconciliation_ok && !loadingRec;
  const contextLine = evidence && !evidence.notAvailable
    ? `Store ${selectedStore} · ${forecastType === 'weekly' ? 'Weekly' : 'Monthly'} · ${formatSelectedPeriod(evidence.period, evidence.forecast_type)}`
    : evidence?.notAvailable
      ? `Store ${selectedStore} · ${forecastType === 'weekly' ? 'Weekly' : 'Monthly'} · evidence unavailable for this period`
      : `Store ${selectedStore} · ${forecastType === 'weekly' ? 'Weekly' : 'Monthly'} · loading forecast period…`;

  return (
    <div className="card mb-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600
                          rounded-2xl flex items-center justify-center shadow-sm flex-shrink-0">
            <Bot size={24} className="text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-gray-800 dark:text-gray-100">Generate AI recommendations</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">{contextLine}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          className={`btn-primary flex items-center justify-center gap-2 w-full sm:w-auto flex-shrink-0 ${
            !canGenerate ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {loadingRec ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating recommendations…
            </>
          ) : 'Generate AI recommendations'}
        </button>
      </div>

      {loadingRec && (
        <div
          role="status"
          aria-live="polite"
          className="mt-5 flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3
                     dark:bg-indigo-500/10 dark:border-indigo-500/20"
        >
          <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="text-sm text-indigo-700 dark:text-indigo-300">
            Claude is analysing forecast data and SHAP explanations. This takes about 20-30 seconds.
          </p>
        </div>
      )}

      <div className="mt-5 flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50/60
                      dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700/60 rounded-xl p-3">
        <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
        <p>
          These are AI-generated decision-support suggestions. A manager should review operational data
          before taking action.
        </p>
      </div>
      <LimitationsDisclosure />
    </div>
  );
}

function EvidenceUsedList({ refs, evidence }) {
  const resolved = (refs || []).map(ref => resolveEvidenceRef(ref, evidence)).filter(Boolean);
  if (resolved.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">
        Evidence used
      </p>
      <ul className="space-y-1">
        {resolved.map((r, i) => (
          <li key={i} className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between gap-3">
            <span>{r.label}</span>
            {r.value != null && <span className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">{r.value}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecommendationCategoryCard({ label, Icon, badge, item, evidence }) {
  const cfg = URGENCY_CONFIG[item?.urgency];
  const UrgencyIcon = cfg?.Icon;
  return (
    <div className="card card-hover">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${badge}`}>
            <Icon size={16} className="text-white" />
          </div>
          <h3 className="font-bold text-gray-800 dark:text-gray-100">{label}</h3>
        </div>
        {item?.urgency && (
          <span className={`badge text-xs gap-1 ${cfg?.classes || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
            {UrgencyIcon && <UrgencyIcon size={12} className={cfg.iconClass} />}
            {item.urgency}
          </span>
        )}
      </div>
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 leading-snug">
        {item?.recommendation}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        {item?.detail}
      </p>
      <EvidenceUsedList refs={item?.evidence_refs} evidence={evidence} />
      {item?.caution && (
        <p className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60 text-xs
                      text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          {item.caution}
        </p>
      )}
    </div>
  );
}

function TransparencySection({ result, evidence }) {
  return (
    <details className="card mt-6 group">
      <summary
        className="cursor-pointer flex items-center gap-1.5 text-sm font-semibold text-gray-700
                   dark:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
                   rounded min-h-[44px] w-fit"
      >
        <ChevronDown size={15} className="group-open:hidden" />
        <ChevronUp size={15} className="hidden group-open:block" />
        <Info size={15} className="text-indigo-600 dark:text-indigo-400" />
        About these AI recommendations
      </summary>
      <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 text-sm">
        <EvidenceRow label="Forecast model" value="XGBoost" />
        <EvidenceRow label="Forecast period" value={formatSelectedPeriod(result.period, result.forecast_type)} />
        <EvidenceRow label="Explanation method" value="Local SHAP" />
        <EvidenceRow label="SHAP source" value={evidence?.explanation_source || 'Precomputed local SHAP'} />
        <EvidenceRow label="Recommendation provider" value={result.provider} />
        <EvidenceRow label="Claude model" value={result.model} />
        <EvidenceRow label="Prompt version" value={result.prompt_version} />
        <EvidenceRow label="Generated" value={formatTimestamp(result.generated_at)} />
        <EvidenceRow label="Runtime model retraining" value="No" />
        <EvidenceRow label="Runtime SHAP calculation" value="No" />
        <EvidenceRow label="Human review required" value="Yes" />
      </dl>
    </details>
  );
}

function buildExportText(result, evidence, selectedStore, forecastType) {
  const rec = result.recommendations;
  const period = formatSelectedPeriod(result.period, forecastType);
  const lines = [
    `AI Recommendations — Store ${selectedStore} · ${forecastType === 'weekly' ? 'Weekly' : 'Monthly'} · ${period}`,
    `Generated: ${formatTimestamp(result.generated_at)} · Provider: ${result.provider} · Model: ${result.model} · Prompt version: ${result.prompt_version}`,
    '',
    'These are AI-generated decision-support suggestions. A manager should review operational data before taking action.',
    '',
    'Summary',
    rec.summary,
    '',
  ];
  RECOMMENDATION_CARDS.forEach(({ key, label }) => {
    const item = rec[key];
    if (!item) return;
    lines.push(`${label} (urgency: ${item.urgency})`);
    lines.push(`Suggested action: ${item.recommendation}`);
    lines.push(`Rationale: ${item.detail}`);
    if (item.caution) lines.push(`Caution: ${item.caution}`);
    lines.push('');
  });
  if (rec.limitations?.length) {
    lines.push('Limitations');
    rec.limitations.forEach(l => lines.push(`- ${l}`));
  }
  return lines.join('\n');
}

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function Agent({ selectedStore, forecastType, setActivePage, handoffPeriod, setHandoffPeriod }) {
  const [result,    setResult]    = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [recError,  setRecError]  = useState(null);
  // Seeds from a period handed off by another page (e.g. Dashboard's "Open
  // AI Recommendations"); null means "use the latest period", exactly as
  // before this page had any period concept. Consumed once, then cleared so
  // a later direct Sidebar visit doesn't reuse a stale historical period.
  // No in-page control changes this once seeded (no Prev/Next on this page,
  // by design — see the plan) so only the getter is needed.
  const [selectedPeriod] = useState(() => handoffPeriod || null);
  useEffect(() => {
    if (handoffPeriod) setHandoffPeriod?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const requestIdRef = useRef(0);
  const { toasts, showToast, dismiss } = useToast();

  const {
    data: evidence, loading: evidenceLoading, error: evidenceError, refetch: refetchEvidence,
  } = useApi(
    () => client.get(`/agent/recommend/evidence?store_id=${selectedStore}&forecast_type=${forecastType}${selectedPeriod ? `&period=${selectedPeriod}` : ''}`)
      .then(res => res.data)
      .catch(err => {
        if (err.response?.status === 404) {
          return { notAvailable: true, detail: err.response?.data?.detail || 'No forecast/SHAP evidence is available for this period.' };
        }
        throw err;
      }),
    [selectedStore, forecastType, selectedPeriod],
    'Could not load forecast and SHAP evidence for this store.'
  );

  // Store, forecast-type or period changes invalidate any in-flight request
  // and clear a prior result — never show a recommendation generated for a
  // different context than the one currently selected.
  useEffect(() => {
    requestIdRef.current += 1;
    setResult(null);
    setRecError(null);
    setLoadingRec(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore, forecastType, selectedPeriod]);

  const generate = useCallback(() => {
    if (loadingRec || !evidence?.reconciliation_ok) return;
    const myRequestId = ++requestIdRef.current;
    setLoadingRec(true);
    setRecError(null);
    client.post(`/agent/recommend?store_id=${selectedStore}&forecast_type=${forecastType}${selectedPeriod ? `&period=${selectedPeriod}` : ''}`)
      .then(res => {
        if (requestIdRef.current !== myRequestId) return; // stale — a newer request/context superseded this one
        setResult(res.data);
      })
      .catch(err => {
        if (requestIdRef.current !== myRequestId) return;
        setRecError(err.response?.data?.detail || 'Recommendation generation failed. Try again.');
      })
      .finally(() => {
        if (requestIdRef.current === myRequestId) setLoadingRec(false);
      });
  }, [selectedStore, forecastType, selectedPeriod, loadingRec, evidence]);

  const handleCopy = () => {
    const text = buildExportText(result, evidence, selectedStore, forecastType);
    navigator.clipboard.writeText(text)
      .then(() => showToast('Recommendations copied to clipboard.'))
      .catch(() => showToast('Could not copy to clipboard.', 'error'));
  };

  const handleDownload = () => {
    const text = buildExportText(result, evidence, selectedStore, forecastType);
    downloadTextFile(text, `ai_recommendations_store${selectedStore}_${result.period}.md`);
    showToast('Recommendations downloaded.');
  };

  const rec = result?.recommendations;

  return (
    <div className="animate-fadeIn">
      <PageHeader
        icon={Bot}
        title="AI Recommendations"
        subtitle={selectedPeriod
          ? 'Claude uses the selected historical forecast and its local SHAP explanation to generate decision-support suggestions for staffing, stock and promotions.'
          : 'Claude uses the latest XGBoost forecast and its local SHAP explanation to generate decision-support suggestions for staffing, stock and promotions.'}
        meta={
          <span className="badge bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/30">
            {selectedPeriod ? `Historical period: ${formatSelectedPeriod(selectedPeriod, forecastType)}` : 'Latest forecast only'}
          </span>
        }
      />

      <PipelineNav setActivePage={setActivePage} />

      <EvidencePreview
        evidence={evidence}
        loading={evidenceLoading}
        error={evidenceError}
        onRetry={refetchEvidence}
        selectedPeriod={selectedPeriod}
        forecastType={forecastType}
      />

      <GenerationCard
        selectedStore={selectedStore}
        forecastType={forecastType}
        evidence={evidence}
        evidenceLoading={evidenceLoading}
        evidenceError={evidenceError}
        loadingRec={loadingRec}
        onGenerate={generate}
      />

      {recError && !loadingRec && (
        <div className="mb-6">
          <AlertBanner variant="error" onRetry={generate}>{recError}</AlertBanner>
        </div>
      )}

      {!rec && !loadingRec && !recError && (
        <EmptyState
          icon={Bot}
          title="No recommendations generated yet"
          message="Review the evidence above, then generate AI recommendations for this store and period."
        />
      )}

      {rec && (
        <div className="animate-fadeIn">
          <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-6 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Lightbulb size={20} className="text-white" />
                <h2 className="font-bold text-white text-base">AI summary</h2>
              </div>
              <span className="bg-white/20 text-white text-xs font-semibold px-3 py-1 rounded-full">
                Store {result.store_id} — {formatSelectedPeriod(result.period, result.forecast_type)}
              </span>
            </div>
            <p className="text-indigo-100 text-sm leading-relaxed">{rec.summary}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {RECOMMENDATION_CARDS.map(({ key, label, Icon, badge }) => (
              <RecommendationCategoryCard
                key={key} label={label} Icon={Icon} badge={badge}
                item={rec[key]} evidence={evidence}
              />
            ))}
          </div>

          {rec.limitations?.length > 0 && (
            <div className="card mb-6">
              <h3 className="card-title flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-500" /> Risks and uncertainties
              </h3>
              <ul className="mt-2 space-y-1.5">
                {rec.limitations.map((l, i) => (
                  <li key={i} className="text-sm text-gray-600 dark:text-gray-300 flex items-start gap-2">
                    <span className="text-gray-400 mt-1">•</span>{l}
                  </li>
                ))}
              </ul>
              <p className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60 text-xs
                            text-gray-500 dark:text-gray-400">
                A manager should review operational data before taking action on these suggestions.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-6">
            <ActionButton icon={RefreshCw} onClick={generate} disabled={loadingRec}>Regenerate</ActionButton>
            <ActionButton icon={Copy} onClick={handleCopy}>Copy recommendations</ActionButton>
            <ActionButton icon={Download} onClick={handleDownload}>Download recommendations</ActionButton>
            {setActivePage && (
              <ActionButton icon={ArrowLeft} onClick={() => setActivePage('explanation')}>Return to Explanation</ActionButton>
            )}
          </div>

          <TransparencySection result={result} evidence={evidence} />
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
