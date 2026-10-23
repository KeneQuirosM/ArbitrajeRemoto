import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };

/**
 * Emits /sw.js with the exact list of built files to precache, so the app
 * opens offline. The cache name changes whenever any file changes.
 */
function serviceWorker(): Plugin {
  return {
    name: 'arbitrajeremoto-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).map((name) => `/${name}`);
      const assets = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', ...files];
      const version = createHash('sha256').update(assets.join('|')).update(JSON.stringify(Object.values(bundle).map((b) => ('code' in b ? b.code.length : 0)))).digest('hex').slice(0, 12);
      const template = readFileSync(fileURLToPath(new URL('./sw-template.js', import.meta.url)), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets)),
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [serviceWorker()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
