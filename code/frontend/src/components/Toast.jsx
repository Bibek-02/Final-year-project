import React from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

const VARIANTS = {
  success: { Icon: CheckCircle2, iconClass: 'text-semantic-success' },
  error  : { Icon: AlertTriangle, iconClass: 'text-semantic-danger' },
};

export default function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2" aria-live="polite">
      {toasts.map(t => {
        const { Icon, iconClass } = VARIANTS[t.variant] || VARIANTS.success;
        return (
          <div
            key={t.id}
            className="flex items-center gap-2 bg-gray-900 text-white rounded-xl
                       shadow-2xl px-4 py-3 text-sm animate-fadeIn min-w-[240px]"
          >
            <Icon size={16} className={`flex-shrink-0 ${iconClass}`} />
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
