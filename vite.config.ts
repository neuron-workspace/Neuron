import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react(), {
    name: 'development-csp',
    // Only the unpackaged app loads Vite. Build keeps index.html's strict policy.
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]+)("\s*\/>)/, (_match, start, policy, end) =>
        start + policy.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace("connect-src 'self'", "connect-src 'self' ws://localhost:5174") + end);
    },
  }],
  base: './', // CRITICAL: Expose relative asset paths for Electron file:// protocol
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
