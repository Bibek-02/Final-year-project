import React from 'react';

// Decorative layer for auth-style screens — gradient base + dot-grid
// texture + blurred accent blobs, all pure CSS. Purely presentational,
// no props/state, so it stays trivially excluded from any future test
// of the pages that use it.
export default function AuthBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-gradient-to-br from-[#0B1220] via-[#0B1220] to-[#111B2E]" />
      <div className="absolute inset-0 bg-dot-grid" />
      <div className="absolute -top-32 -left-24 h-[28rem] w-[28rem] rounded-full bg-[#5B5CEB]/20 blur-[110px]" />
      <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-[#8EA8FF]/10 blur-[110px]" />
    </div>
  );
}
