import React from 'react';
import { Inbox } from 'lucide-react';

export default function EmptyState({ icon: Icon = Inbox, title = 'Nothing to show', message, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-12 h-12 bg-gray-50 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-3">
        <Icon size={22} className="text-gray-300 dark:text-gray-600" />
      </div>
      <p className="font-semibold text-gray-600 dark:text-gray-300 text-sm">{title}</p>
      {message && <p className="text-secondary text-xs mt-1 max-w-xs">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
