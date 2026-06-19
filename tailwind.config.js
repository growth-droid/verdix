// slate + white are backed by CSS variables (see index.css) so every existing
// text-slate-*/bg-slate-*/border-white-* class flips automatically between themes.
const slate = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map(k => [k, `rgb(var(--s${k}) / <alpha-value>)`]),
)

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        num: ['"Plus Jakarta Sans"', 'Outfit', 'ui-sans-serif', 'sans-serif'],
      },
      colors: {
        slate,
        white: 'rgb(var(--white) / <alpha-value>)',
        ink: 'rgb(var(--s100) / <alpha-value>)',
        muted: 'rgb(var(--s400) / <alpha-value>)',
        faint: 'rgb(var(--s500) / <alpha-value>)',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(249,115,22,.35), 0 4px 24px -6px rgba(249,115,22,.45)',
        card: 'var(--card-shadow)',
        pop: 'var(--pop-shadow)',
      },
      keyframes: {
        fadeUp: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
      },
      animation: { fadeUp: 'fadeUp .35s ease both', shimmer: 'shimmer 1.6s linear infinite' },
    },
  },
  plugins: [],
}
