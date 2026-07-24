// Primitive OKLCH ramps from packages/ui/src/tokens.css, precomputed to hex for RN (plan §11.3).
// The source of truth stays the web tokens.css; this mirror is asserted by a parity test (added
// in the component-gallery increment). Screens NEVER import these directly — they use semantic
// role classes (bg-surface, text-ink, ...) defined in global.css / tailwind.config.js.
export const ramps = {
  neutral: {
    50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af',
    500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827',
  },
  brand: {
    50: '#eef2ff', 100: '#e0e7ff', 200: '#c6d2ff', 300: '#a3b3ff', 400: '#7c86ff',
    500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3',
  },
  danger: { 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c' },
  caution: { 400: '#fb923c', 500: '#f97316', 600: '#ea580c' },
  warning: { 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
  success: { 400: '#4ade80', 500: '#22c55e', 600: '#16a34a' },
  info: { 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb' },
} as const;
