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
        // TND: DM Sans is the default UI/label face; Fraunces (serif) is the display/heading face;
        // Plus Jakarta stays for tabular numbers. Outfit kept only as a fallback in the stack.
        sans: ['"DM Sans"', 'Outfit', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'ui-serif', 'serif'],
        serif: ['Fraunces', 'Georgia', 'ui-serif', 'serif'],
        quote: ['"Cormorant Garamond"', 'Georgia', 'ui-serif', 'serif'],
        num: ['"Plus Jakarta Sans"', 'Outfit', 'ui-sans-serif', 'sans-serif'],
      },
      colors: {
        slate,
        white: 'rgb(var(--white) / <alpha-value>)',
        ink: 'rgb(var(--s100) / <alpha-value>)',
        muted: 'rgb(var(--s400) / <alpha-value>)',
        faint: 'rgb(var(--s500) / <alpha-value>)',
        // TND metallic gold accent (light/dark values supplied by --gold in index.css)
        gold: 'rgb(var(--gold) / <alpha-value>)',
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--gold) / .35), 0 4px 24px -6px rgb(var(--gold) / .5)',
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
