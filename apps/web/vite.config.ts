import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser only talks to this server; /api is passed on to the API, so
// the login cookie stays on one address (PUBLIC_URL) and no CORS is needed.
const proxy = {
  '/api': { target: process.env.API_URL ?? 'http://localhost:3000', xfwd: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
