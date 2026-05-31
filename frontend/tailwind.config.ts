import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}", "./pages/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      backdropBlur: {
        none: '0',
        sm: '0',    // Disable blur for dropdowns
        DEFAULT: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        '3xl': '0',
      },
      colors: {
        midnight: "#030717",
        "brand-navy": "#07112C",
        "brand-panel": "#0A1027",
        "cyber-blue": "#10A9FF",
        aurora: "#7A3DFF",
        sunset: "#F6B21A",
        "brand-cyan": "#18D1FF",
        "brand-orange-soft": "#FFD15C",
        "neon-green": "#18D1FF",
        "neon-purple": "#7A3DFF",
        "neon-orange": "#F6B21A",
        "gold-yellow": "#FFD15C",
        "text-light": "#EEF5FF",
        "parchment-light": "#F7FBFF",
        "parchment-dark": "#B6CBFF",
      },
      boxShadow: {
        'glow-blue': '0 0 14px rgba(16, 169, 255, 0.45), 0 0 30px rgba(61, 108, 255, 0.2)',
        'glow-blue-strong': '0 24px 64px rgba(3, 10, 38, 0.68), 0 0 42px rgba(16, 169, 255, 0.16)',
        'glow-green': '0 0 10px rgba(24, 209, 255, 0.35)',
        'glow-purple': '0 0 14px rgba(122, 61, 255, 0.28)',
        'glow-orange': '0 0 14px rgba(246, 178, 26, 0.34), 0 0 28px rgba(255, 209, 92, 0.18)',
        'glow-yellow': '0 0 10px rgba(255, 209, 92, 0.36)',
      },
      animation: {
        'in': 'in 0.5s ease-out',
        'spin': 'spin 1s linear infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
      keyframes: {
        in: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        spin: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 8px #00BFFF, 0 0 12px #00BFFF' },
          '50%': { boxShadow: '0 0 20px #00BFFF, 0 0 30px #00BFFF' },
        }
      }
    }
  },
  plugins: []
};

export default config;
