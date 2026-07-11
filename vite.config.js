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
  },
})
