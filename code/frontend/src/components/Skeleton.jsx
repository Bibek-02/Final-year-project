import React from 'react';

function Bar({ className = '', style }) {
  return <div className={`animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg ${className}`} style={style} />;
}

export function SkeletonCard() {
  return (
    <div className="metric-card">
      <Bar className="h-3 w-20 mb-3" />
      <Bar className="h-7 w-24 mb-2" />
      <Bar className="h-2.5 w-16" />
    </div>
  );
}

export function SkeletonChart({ height = 320 }) {
  return (
    <div className="card">
      <Bar className="h-4 w-40 mb-5" />
      <Bar style={{ height }} className="w-full" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="card">
      <Bar className="h-4 w-40 mb-5" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4">
            {Array.from({ length: cols }).map((__, c) => (
              <Bar key={c} className="h-3 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
