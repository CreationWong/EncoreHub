/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				app: {
					canvas: "var(--color-app-canvas)",
				},
				workspace: "var(--color-workspace)",
				control: "var(--color-control-surface)",
				selected: "var(--color-selected-surface)",
				surface: {
					DEFAULT: "var(--color-surface)",
					alt: "var(--color-surface-alt)",
					hover: "var(--color-surface-hover)",
				},
				border: {
					DEFAULT: "var(--color-border)",
				},
				text: {
					primary: "var(--color-text-primary)",
					secondary: "var(--color-text-secondary)",
					muted: "var(--color-text-muted)",
				},
				accent: {
					DEFAULT: "var(--color-accent)",
					hover: "var(--color-accent-hover)",
				},
				success: {
					DEFAULT: "var(--color-success)",
					bg: "var(--color-success-bg)",
					border: "var(--color-success-border)",
				},
				warning: {
					DEFAULT: "var(--color-warning)",
					bg: "var(--color-warning-bg)",
					border: "var(--color-warning-border)",
				},
				danger: {
					DEFAULT: "var(--color-danger)",
					bg: "var(--color-danger-bg)",
					border: "var(--color-danger-border)",
				},
				info: {
					DEFAULT: "var(--color-info)",
					bg: "var(--color-info-bg)",
					border: "var(--color-info-border)",
				},
				code: {
					bg: "var(--color-code-bg)",
				},
				window: {
					close: "var(--color-window-close)",
					minimize: "var(--color-window-minimize)",
					maximize: "var(--color-window-maximize)",
					symbol: "var(--color-window-symbol)",
				},
			},
			fontFamily: {
				sans: [
					'"Segoe UI Variable"',
					'"Segoe UI"',
					'"Microsoft YaHei UI"',
					'"PingFang SC"',
					'"Noto Sans CJK SC"',
					"sans-serif",
				],
				mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
			},
			animation: {
				"fade-in": "fadeIn 0.15s ease-in-out",
				"slide-up": "slideUp 0.2s ease-out",
				"cursor-blink": "blink 1s step-end infinite",
			},
		},
	},
	plugins: [],
};
