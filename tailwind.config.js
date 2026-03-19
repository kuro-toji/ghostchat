/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'void': '#080808',
        'surface': '#111111',
        'elevated': '#1a1a1a',
        'ghost-white': '#e8e8f0',
        'ghost-dim': '#555566',
        'accent-glow': '#7c6aff',
        'accent-safe': '#00ffaa',
        'accent-danger': '#ff4466',
        'border-subtle': '#1e1e2a',
      },
      fontFamily: {
        'mono': ['"Space Mono"', '"Fira Code"', 'monospace'],
        'sans': ['"DM Sans"', 'Inter', 'system-ui', 'sans-serif'],
        'code': ['"Fira Code"', '"Space Mono"', 'monospace'],
      },
      animation: {
        'ghost-pulse': 'ghostPulse 2s ease-in-out infinite',
        'ghost-glow': 'ghostGlow 3s ease-in-out infinite',
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.6s ease-out',
        'online-pulse': 'onlinePulse 2s ease-in-out infinite',
      },
      keyframes: {
        ghostPulse: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        ghostGlow: {
          '0%, 100%': { 
            textShadow: '0 0 20px rgba(124, 106, 255, 0.3)',
            filter: 'drop-shadow(0 0 10px rgba(124, 106, 255, 0.2))',
          },
          '50%': { 
            textShadow: '0 0 40px rgba(124, 106, 255, 0.6)',
            filter: 'drop-shadow(0 0 20px rgba(124, 106, 255, 0.4))',
          },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        onlinePulse: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
      },
      boxShadow: {
        'glow': '0 0 20px rgba(124, 106, 255, 0.15)',
        'glow-lg': '0 0 40px rgba(124, 106, 255, 0.25)',
        'glow-safe': '0 0 20px rgba(0, 255, 170, 0.15)',
      },
    },
  },
  plugins: [],
};
