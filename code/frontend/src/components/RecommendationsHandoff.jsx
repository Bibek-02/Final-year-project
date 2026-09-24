import React from 'react';
import { Bot, ArrowRight } from 'lucide-react';

export default function RecommendationsHandoff({ onOpen }) {
  if (!onOpen) return null;

  return (
    <div className="card mt-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center
                          justify-center flex-shrink-0">
            <Bot size={18} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">
              What should the store consider next?
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Open AI Recommendations to review staffing, stock and promotion suggestions based on
              this forecast and its modelled drivers.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="btn-primary flex items-center gap-1.5 flex-shrink-0 text-sm"
        >
          Open AI Recommendations <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
