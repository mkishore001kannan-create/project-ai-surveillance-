import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: '0.0.0.0',
    port: 6116,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
})
