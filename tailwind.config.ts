import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0f4c81",
          dark: "#0b3a63",
          tint: "#e8f0f7",
        },
      },
    },
  },
  plugins: [],
};

export default config;
