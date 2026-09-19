// Validated with the dataviz skill's color-formula checks (lightness band,
// chroma floor, CVD separation, contrast) — keep in sync with the `chart`/
// `status` entries in tailwind.config.js. Raw hex here because Recharts
// stroke/fill/<Cell>/tooltip props need literal color values, not class names.
export const chart = {
  actual: '#4f46e5',
  predicted: '#eb6834',
  positive: '#4f46e5',
  negative: '#e34948',
};

export const status = {
  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
};

// One semantic vocabulary shared across cards/badges/charts — keep in
// sync with the `semantic` colors in tailwind.config.js.
export const semantic = {
  primary: '#4f46e5',
  success: status.good,
  warning: status.warning,
  danger: status.critical,
  info: '#0284c7',
  positive: chart.positive,
  negative: chart.negative,
};

// Dark-background counterparts — same hue families, lighter tints. The sets
// above were validated for contrast against a *white* background; the same
// hex on a dark surface reads low-contrast, so this isn't a re-skin, it's a
// second validated palette. Consumed via `useChartColors()`
// (src/hooks/useChartColors.js), not imported directly by pages.
export const chartDark = {
  actual: '#818cf8',
  predicted: '#fb923c',
  positive: '#818cf8',
  negative: '#f87171',
};

export const statusDark = {
  good: '#4ade80',
  warning: '#fbbf24',
  critical: '#f87171',
};

export const semanticDark = {
  primary: '#818cf8',
  success: statusDark.good,
  warning: statusDark.warning,
  danger: statusDark.critical,
  info: '#38bdf8',
  positive: chartDark.positive,
  negative: chartDark.negative,
};
