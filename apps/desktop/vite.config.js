import { defineConfig } from 'vite';

const buildId =
  process.env.BIRDIE_DESKTOP_BUILD_ID ?? 'development-unversioned';

export default defineConfig({
  clearScreen: false,
  define: {
    __BIRDIE_DESKTOP_BUILD_ID__: JSON.stringify(buildId),
  },
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2021',
    minify: !process.env.TAURI_DEBUG,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
