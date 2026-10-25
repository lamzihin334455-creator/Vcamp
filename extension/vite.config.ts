import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(['test-extension','capture-test'].includes(mode) ? [{ name: 'local-http-test-permission', async closeBundle() {
    const file = resolve(mode==='capture-test'?'dist-capture/manifest.json':'dist-test/manifest.json'), manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.host_permissions.push('http://127.0.0.1/*'); await writeFile(file, JSON.stringify(manifest, null, 2));
  } }] : [])],
  resolve: { alias: { '@binding': resolve(mode === 'test-extension' ? 'tests/adapters/binding.ts' : 'src/app/unbound.ts'), '@provider-endpoint': resolve(['test-extension','capture-test'].includes(mode) ? 'tests/adapters/provider-endpoint.ts' : 'src/generation/provider-endpoint.ts'), '@generation-video': resolve(mode === 'test-extension' ? 'tests/adapters/generation-video.ts' : 'src/generation/test-video-fallback.ts') } },
  build: {
    outDir: mode==='capture-test'?'dist-capture':mode === 'test-extension' ? 'dist-test' : 'dist',
    rollupOptions: {
      input: { ...(mode === 'capture-test' ? { mediaProbe: resolve('tests/installed/t16-media-probe.html') } : {}), ...(mode === 'test-extension' ? { optFunctionSeed:resolve('tests/installed/opt-function-seed.html'), htmlCompatSeed: resolve('tests/installed/html-compat-seed.html'), rectifySeed: resolve('tests/installed/rectify-b-seed.html'), backupSeed: resolve('tests/installed/backup-seed.html'), librarySeed: resolve('tests/installed/library-seed.html'), managementSeed: resolve('tests/installed/management-seed.html') } : {}), sandbox: resolve(__dirname, 'sandbox.html'), panel: resolve('sidepanel.html'), reader: resolve('reader.html'), executor: resolve('executor.html'), background: resolve('src/background.ts'), observer: resolve('src/content/observer.ts') },
      output: { entryFileNames: 'assets/[name].js', chunkFileNames: 'assets/[name]-[hash].js' }
    }
  }
}));
