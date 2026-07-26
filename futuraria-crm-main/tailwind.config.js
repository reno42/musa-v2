/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Twenty-style neutral palette (no purple brand)
        gray: {
          1: '#FFFFFF',
          2: '#FBFBFB',
          3: '#F9F9F9',
          4: '#F4F4F4',
          5: '#EFEFEF',
          6: '#D9D9D9',
          7: '#CCCCCC',
          8: '#B3B3B3',
          9: '#999999',
          10: '#828282',
          11: '#666666',
          12: '#333333',
        },
        // Accent (used sparingly)
        accent: {
          blue: '#5B5FC7',
          purple: '#7C5CFC',
          green: '#22C55E',
          red: '#EF4444',
          orange: '#F59E0B',
        },
        // Status colors
        status: {
          success: '#22C55E',
          error: '#EF4444',
          warning: '#F59E0B',
          info: '#3B82F6',
        },
        // Stage colors (muted versions)
        stage: {
          new: '#6366F1',
          researching: '#8B5CF6',
          contacted: '#A78BFA',
          qualified: '#F59E0B',
          demo: '#3B82F6',
          proposal: '#EC4899',
          negotiation: '#F97316',
          won: '#22C55E',
          lost: '#EF4444',
          nurturing: '#6B7280',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        'xs': ['12px', { lineHeight: '16px' }],
        'sm': ['13px', { lineHeight: '18px' }],
        'base': ['14px', { lineHeight: '20px' }],
        'lg': ['16px', { lineHeight: '22px' }],
        'xl': ['20px', { lineHeight: '28px' }],
        '2xl': ['24px', { lineHeight: '32px' }],
      },
      borderRadius: {
        'xs': '2px',
        'sm': '4px',
        'md': '8px',
        'xl': '12px',
        '2xl': '16px',
        'pill': '999px',
      },
      borderColor: {
        DEFAULT: '#EFEFEF',
      },
    },
  },
  plugins: [],
}
