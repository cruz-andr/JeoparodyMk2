import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      /* The board format is shared with the API and has to live under server/,
         because the server image is built from that directory alone: a module
         the API imports cannot sit in src/ or it is simply not there in
         production. The alias is so client code does not have to say
         ../../server/shared/ to reach it. */
      '@shared': fileURLToPath(new URL('./server/shared', import.meta.url)),
    },
  },
  build: {
    minify: 'terser',
  },
  server: {
    port: 5000,
  },
})
