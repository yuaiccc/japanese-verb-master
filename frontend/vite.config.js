import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      '5173-izxk4e2pvaq0yimuwkt5n-e59cb212.sg1.manus.computer',
      'localhost',
      '127.0.0.1',
      '169.254.0.21'
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
