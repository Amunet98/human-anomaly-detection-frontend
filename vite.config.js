import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { microfrontends } from '@vercel/microfrontends/experimental/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    microfrontends(),
    babel({
      presets: [
        ['@babel/preset-react', { runtime: 'automatic' }],
        reactCompilerPreset()
      ]
    })
  ],
  // This tells the pre-bundling scanner how to interpret .js files containing components
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.js$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
    // onnxruntime-web locates its .wasm with
    //   new URL('ort-wasm-simd-threaded.jsep.wasm', import.meta.url)
    // which Vite's asset-import-meta-url transform rewrites into a hashed
    // emitted asset. Dep pre-bundling rewrites that expression first, so the
    // transform never sees it and the wasm 404s in dev. Excluding ORT from
    // pre-bundling is what keeps the automatic path working.
    exclude: ['onnxruntime-web'],
  },
  // The detector runs in a module worker (session.run() blocks synchronously on
  // the wasm backend, which would stall rAF and defeat the whole point).
  worker: { format: 'es' },
})
