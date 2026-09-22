import React from 'react';

export default function LoadingState({ label = 'Loading…', inline = false }) {
  if (inline) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent
                        rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent
                        rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">{label}</p>
      </div>
    </div>
  );
}
