import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function ConfirmModal({
  open, title, message, confirmLabel = 'Confirm', danger = true, onConfirm, onCancel,
}) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-gray-900/60 animate-fadeIn"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="relative bg-white dark:bg-gray-800 dark:border dark:border-gray-700
                   rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-fadeIn"
      >
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            danger
              ? 'bg-red-50 text-semantic-danger dark:bg-red-500/10 dark:text-red-400'
              : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
          }`}>
            <AlertTriangle size={20} />
          </div>
          <h2 id="confirm-modal-title" className="card-title">{title}</h2>
        </div>
        <p className="text-secondary text-sm mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600
                       hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700
                       transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-sm font-semibold text-white
                        transition-colors ${
              danger ? 'bg-semantic-danger hover:bg-red-600' : 'btn-primary'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
