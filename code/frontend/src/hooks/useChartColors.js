import { useTheme } from '../context/ThemeContext';
import { chart, semantic, chartDark, semanticDark } from '../lib/theme';

// One theme-aware bundle for every Recharts-bearing page: series/semantic
// colors plus the SVG chrome (grid/axis/tooltip) that Tailwind's `dark:`
// variant can't reach, since these are inline style/props, not classes.
export function useChartColors() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return {
    chart: isDark ? chartDark : chart,
    semantic: isDark ? semanticDark : semantic,
    grid: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9',
    axisTick: '#9ca3af',
    axisLabel: isDark ? '#d1d5db' : '#6b7280',
    tooltip: {
      background: isDark ? '#1f2937' : '#ffffff',
      border: isDark ? '#374151' : '#e2e8f0',
      text: isDark ? '#f3f4f6' : '#111827',
    },
  };
}
