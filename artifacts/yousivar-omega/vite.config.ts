import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

// Base44 sandbox: the API runs as its own compose service while the browser
// talks to relative `/api/...` paths (see lib/api-client-react) on a single
// origin, so in preview mode the dev server proxies those requests to the API.
// Only active when BASE44_PREVIEW_MODE is exactly "1"; otherwise the original
// configuration is untouched.
const previewApiOrigin =
  process.env.BASE44_PREVIEW_MODE === '1'
    ? process.env.API_PROXY_ORIGIN
    : undefined;

// Android packages are served from this app (see the Android download section in
// src/App.tsx). Without an explicit content type the static file handler sends an
// empty one and some browsers and download managers refuse the file. A production
// host needs the same mapping — see DEPLOYMENT.md.
const apkContentType = 'application/vnd.android.package-archive';
function apkMimeTypePlugin(): Plugin {
  const middleware = (
    req: { url?: string },
    res: { setHeader: (name: string, value: string) => void },
    next: () => void,
  ) => {
    if (req.url?.split('?')[0]?.toLowerCase().endsWith('.apk')) {
      res.setHeader('Content-Type', apkContentType);
    }
    next();
  };
  return {
    name: 'omega-apk-content-type',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    apkMimeTypePlugin(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    ...(previewApiOrigin
      ? {
          proxy: {
            '/api': {
              target: previewApiOrigin,
              // Keep the original Host header so the API's same-origin check
              // still sees the client-facing host it expects.
              changeOrigin: false,
              // Forward the client address so the API can rate limit owner
              // access attempts per visitor instead of per proxy.
              xfwd: true,
              ws: true,
            },
          },
        }
      : {}),
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
