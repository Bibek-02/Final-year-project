import React from 'react';

export default function PageHeader({ icon: Icon, title, titleAccent, subtitle, meta }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl
                          flex items-center justify-center flex-shrink-0 mt-0.5">
            <Icon size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
        )}
        <div>
          <h1 className="page-title">
            {title}
            {titleAccent && <span className="text-indigo-500 dark:text-indigo-400 ml-2">{titleAccent}</span>}
          </h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
      </div>
      {meta && (
        <p className="text-secondary text-xs mt-1">{meta}</p>
      )}
    </div>
  );
}
