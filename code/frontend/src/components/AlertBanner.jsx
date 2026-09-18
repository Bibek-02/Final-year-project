import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

const VARIANTS = {
  error  : { classes: 'bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400',       Icon: AlertTriangle },
  warning: { classes: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400', Icon: AlertTriangle },
  success: { classes: 'bg-green-50 border-green-200 text-green-700 dark:bg-green-500/10 dark:border-green-500/30 dark:text-green-400', Icon: CheckCircle2  },
};

export default function AlertBanner({ variant = 'error', children, onRetry }) {
  const { classes, Icon } = VARIANTS[variant];
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`border rounded-2xl p-4 text-sm flex items-center gap-2 ${classes}`}
    >
      <Icon size={16} className="flex-shrink-0" />
      <span className="flex-1">{children}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs font-semibold underline underline-offset-2
                     hover:no-underline flex-shrink-0"
        >
          Retry
        </button>
      )}
    </div>
  );
}
