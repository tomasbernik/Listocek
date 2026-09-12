import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/Listocek/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Lístoček',
        short_name: 'Lístoček',
        description: 'Spoločný nákupný zoznam',
        theme_color: '#f7f5ef',
        background_color: '#f7f5ef',
        display: 'standalone',
        start_url: '/Listocek/',
        scope: '/Listocek/',
        icons: [{ src: '/Listocek/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
      },
      workbox: {
        navigateFallback: '/Listocek/index.html',
        runtimeCaching: []
      }
    })
  ]
})

