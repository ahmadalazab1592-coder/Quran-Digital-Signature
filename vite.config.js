import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,ttf,woff,woff2}'],
        // 🟢 السماح بتخزين ملفات ضخمة تصل إلى 10 ميجابايت (ضروري لقاعدة بيانات القرآن)
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024 
      },
      manifest: {
        name: 'Quran Digital Signature',
        short_name: 'Quran Radar',
        description: 'منصة البصمة الرقمية للقرآن الكريم',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'favicon.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml'
          }
        ]
      }
    })
  ],
  // 🟢 إخفاء التحذير الخاص بحجم الملفات الكبيرة في بيئة البناء
  build: {
    chunkSizeWarningLimit: 10000 
  }
})