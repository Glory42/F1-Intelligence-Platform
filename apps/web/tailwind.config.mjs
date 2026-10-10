/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    // override ALL border-radius — sharp corners like portfolio
    borderRadius: {
      none:    '0px',
      sm:      '0px',
      DEFAULT: '0px',
      md:      '0px',
      lg:      '0px',
      xl:      '0px',
      '2xl':   '0px',
      '3xl':   '0px',
      full:    '9999px',  // keep for dots / avatars
    },
    extend: {
      colors: {
        border:       'hsl(var(--border))',
        input:        'hsl(var(--input))',
        ring:         'hsl(var(--ring))',
        background:   'hsl(var(--background))',
        foreground:   'hsl(var(--foreground))',
        primary:      { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary:    { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive:  { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted:        { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent:       { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card:         { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        'accent-primary':  'hsl(var(--accent-primary) / <alpha-value>)',
        'accent-bright':   'hsl(var(--accent-bright) / <alpha-value>)',
        'accent-electric': 'hsl(var(--accent-electric) / <alpha-value>)',
        success:           'hsl(var(--success) / <alpha-value>)',
        surface:           'hsl(var(--surface) / <alpha-value>)',
        text: { secondary: 'hsl(var(--text-secondary) / <alpha-value>)' },
        tyre: {
          soft:    'hsl(var(--tyre-soft) / <alpha-value>)',
          medium:  'hsl(var(--tyre-medium) / <alpha-value>)',
          hard:    'hsl(var(--tyre-hard) / <alpha-value>)',
          inter:   'hsl(var(--tyre-inter) / <alpha-value>)',
          wet:     'hsl(var(--tyre-wet) / <alpha-value>)',
          unknown: 'hsl(var(--tyre-unknown) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans:    ['Sora', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'ui-monospace', 'monospace'],
        heading: ['Sora', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up':   { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        flow:        { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(200%)' } },
        'pulse-glow':{ '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        telemetry:   { '0%': { strokeDashoffset: '1000' }, '100%': { strokeDashoffset: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
        flow:             'flow 2s linear infinite',
        'pulse-glow':     'pulse-glow 2s ease-in-out infinite',
        telemetry:        'telemetry 4s linear infinite alternate',
      },
      // Apple "Fluid Interfaces" curves, opt-in via `ease-spring`/`ease-spring-bounce` for
      // entrances/exits — Tailwind's DEFAULT stays neutral for plain hover/color transitions.
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.32, 0.72, 0, 1)',
        'spring-bounce': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
