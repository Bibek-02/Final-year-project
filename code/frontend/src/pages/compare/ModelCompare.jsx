import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { Scale, Trophy } from 'lucide-react';
import client from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { useChartColors } from '../../hooks/useChartColors';
import PageHeader from '../../components/PageHeader';
import AlertBanner from '../../components/AlertBanner';
import { SkeletonCard, SkeletonChart, SkeletonTable } from '../../components/Skeleton';

const METRICS = ['MAE', 'RMSE', 'MAPE', 'RMSPE'];
const MOVING_AVERAGE_COLOR = '#94a3b8'; // slate-400 — reads fine on both light and dark

function getColor(model, cc) {
  if (model === 'Random Forest') return cc.chart.predicted;
  if (model === 'XGBoost') return cc.chart.actual;
  if (model?.startsWith('Moving Average')) return MOVING_AVERAGE_COLOR;
  return cc.chart.actual;
}

export default function ModelCompare() {
  const cc = useChartColors();
  const [activeMetric, setActiveMetric] = useState('RMSE');

  const { data, loading, error, refetch } = useApi(
    () => Promise.all([
      client.get('/models/compare?forecast_type=weekly'),
      client.get('/models/compare?forecast_type=monthly'),
      client.get('/models/best?forecast_type=weekly'),
      client.get('/models/best?forecast_type=monthly'),
    ]).then(([w, m, bw, bm]) => ({
      weeklyData : w.data.comparison,
      monthlyData: m.data.comparison,
      bestWeekly : bw.data,
      bestMonthly: bm.data,
    })),
    [],
    'Failed to load comparison data.'
  );

  if (loading) return (
    <div className="animate-fadeIn space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
      <SkeletonChart height={220} />
      <SkeletonChart height={220} />
      <SkeletonTable rows={6} cols={5} />
    </div>
  );

  if (error) return <AlertBanner variant="error" onRetry={refetch}>{error}</AlertBanner>;

  const { weeklyData, monthlyData, bestWeekly, bestMonthly } = data;

  const renderChart = (data, title) => (
    <div className="card mb-6">
      <h2 className="card-title mb-3">{title}</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
          <XAxis dataKey="Model" tick={{ fontSize: 10, fill: cc.axisLabel }} interval={0}
                 tickFormatter={m => m.replace('Moving Average ', 'MA ')} />
          <YAxis tick={{ fontSize: 11, fill: cc.axisTick }} />
          <Tooltip
            contentStyle={{ borderRadius: '12px', border: `1px solid ${cc.tooltip.border}`,
                            background: cc.tooltip.background, color: cc.tooltip.text,
                            fontSize: '13px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
          />
          <Bar dataKey={activeMetric} radius={[6, 6, 0, 0]} isAnimationActive={false}>
            {data.map((entry, i) => (
              <Cell key={i} fill={getColor(entry.Model, cc)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  const renderTable = (data, title) => (
    <div className="card mb-6">
      <h2 className="card-title mb-3">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-3 text-left rounded-l-xl">Model</th>
              {METRICS.map(m => (
                <th key={m} className="px-4 py-3 text-left">{m}</th>
              ))}
              <th className="px-4 py-3 text-left rounded-r-xl">Rank</th>
            </tr>
          </thead>
          <tbody>
            {[...data].sort((a, b) => a.RMSE - b.RMSE).map((row, i) => (
              <tr key={i} className={`table-row ${i === 0 ? 'bg-indigo-50/40 dark:bg-indigo-500/10' : ''}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ background: getColor(row.Model, cc) }} />
                    <span className="font-medium text-gray-700 dark:text-gray-300 text-xs">
                      {row.Model}
                    </span>
                  </div>
                </td>
                {METRICS.map(m => (
                  <td key={m} className={`px-4 py-3 text-xs ${
                    m === 'RMSE'
                      ? 'font-bold text-indigo-600 dark:text-indigo-400'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}>
                    {row[m]}
                  </td>
                ))}
                <td className="px-4 py-3">
                  {i === 0
                    ? (
                      <span className="badge bg-green-100 text-green-700 gap-1 dark:bg-green-500/10 dark:text-green-400">
                        <Trophy size={12} /> Best
                      </span>
                    )
                    : <span className="text-gray-400 dark:text-gray-500 text-xs">#{i + 1}</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="animate-fadeIn">
      <PageHeader
        icon={Scale}
        title="Model Comparison"
        subtitle="The evidence behind the champion model choice — Moving Average vs Random Forest vs XGBoost on test-set performance"
      />

      {/* Champion badges — the two numbers this whole page exists to justify,
          so they get a visibly distinct treatment (ring + tinted border)
          rather than blending into the generic .card style below. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {[['Weekly', bestWeekly], ['Monthly', bestMonthly]].map(([label, best]) => best && (
          <div key={label} className="card ring-2 ring-indigo-100 border-indigo-200
                                      dark:ring-indigo-500/20 dark:border-indigo-500/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center
                              justify-center text-white flex-shrink-0">
                <Trophy size={20} />
              </div>
              <div>
                <p className="field-label">{label} champion</p>
                <p className="card-title">{best.best_model}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {METRICS.map(m => (
                <div key={m} className="bg-gray-50 rounded-xl p-3 text-center
                                        border border-gray-100 dark:bg-gray-900/50 dark:border-gray-700">
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{m}</p>
                  <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{best[m]}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Metric selector */}
      <div className="card mb-6">
        <p className="field-label mb-3">Select metric for chart</p>
        <div className="flex flex-wrap gap-2">
          {METRICS.map(m => (
            <button
              key={m}
              onClick={() => setActiveMetric(m)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold
                          transition-all duration-150 ${
                activeMetric === m
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {renderChart(weeklyData,  `Weekly — ${activeMetric} comparison`)}
      {renderChart(monthlyData, `Monthly — ${activeMetric} comparison`)}
      {renderTable(weeklyData,  'Weekly results — all metrics')}
      {renderTable(monthlyData, 'Monthly results — all metrics')}
    </div>
  );
}
