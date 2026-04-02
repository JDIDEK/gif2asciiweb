import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

const isDocker = process.env.DOCKER === '1';

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait()
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: isDocker,
      interval: isDocker ? 120 : undefined
    },
    hmr: {
      clientPort: 5173
    },
    fs: {
      allow: [
        '..', 
        './'
      ]
    }
  }
})