import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Split the two giant, framework-agnostic vendor libs (echarts core + maplibre-gl, ~1.8 MB raw)
// into their own chunks so the browser fetches them in parallel and caches them across deploys.
// We deliberately do NOT split react / react-router into a separate chunk — that produced a
// circular vendor↔react chunk (risky init order). echarts-for-react is the tiny wrapper that
// bridges echarts↔react, so it stays in the app chunk to avoid an echarts↔app cycle.
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('echarts-for-react')) return            // wrapper → keep with app
          if (id.includes('echarts') || id.includes('zrender')) return 'echarts'
          if (id.includes('maplibre')) return 'maplibre'
        },
      },
    },
  },
})
