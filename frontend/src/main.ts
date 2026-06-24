import { createApp } from 'vue';
import axios from 'axios';
import './styles/shared.css';
import App from './App.vue';

// 生产构建注入后端地址（Vercel 上设 VITE_API_BASE=https://...onrender.com）。
// 开发不设此变量时退到相对路径，走 vite.config.ts 的 /api proxy。
const apiBase = import.meta.env.VITE_API_BASE;
if (apiBase) axios.defaults.baseURL = apiBase;

const app = createApp(App);
app.mount('#app');
