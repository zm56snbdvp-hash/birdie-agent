import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

function resolveBuildId() {
  if (process.env.BIRDIE_DESKTOP_BUILD_ID) return process.env.BIRDIE_DESKTOP_BUILD_ID;
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    return `${sha}-stream-${status ? 'dirty' : 'clean'}`;
  } catch {
    return 'development-unversioned';
  }
}

const buildId = resolveBuildId();

export default defineConfig({
  clearScreen: false,
  define: {
    __BIRDIE_DESKTOP_BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    hmr: { overlay: false },
    watch: { ignored: ['**/src-tauri/target/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2021',
    minify: !process.env.TAURI_DEBUG,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
