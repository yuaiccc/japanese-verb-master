<div align="center">

# 🌸 Japanese Verb Master

[![Vue 3](https://img.shields.io/badge/Vue.js-3.0-4FC08D?style=for-the-badge&logo=vue.js)](https://vuejs.org/)
[![Express](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express)](https://expressjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge)](http://makeapullrequest.com)

**The ultimate, precise Japanese verb conjugation tool and API.**

[简体中文](./README.md) | [日本語](./README_JA.md)

</div>

---

### ✨ Features

- 🎯 **High Accuracy**: Precise conjugation rules for Godan, Ichidan, and Irregular verbs (Suru / Kuru).
- ⚡ **Real-time**: Instant results powered by a modern Vue 3 + Vite frontend.
- 📚 **Comprehensive**: Covers 10+ conjugation forms including Te-form, Ta-form, Passive, Causative, Potential, and more.
- 🤖 **AI-Powered Analysis**: Integrated with Ollama local models for automatic verification and example sentence generation.
- 🔌 **REST API**: Built-in Express backend providing clean JSON APIs for developers to build upon.
- 📱 **Responsive Design**: Works perfectly on both mobile and desktop.

### 🚀 Quick Start

#### 1. Clone the repository
```bash
git clone https://github.com/yuaiccc/japanese-verb-master.git
cd japanese-verb-master
```

#### 2. Start the Backend API
```bash
cd backend
npm install
npm run dev # Runs on port 3000
```

#### 3. Start the Frontend
```bash
cd frontend
npm install
npm run dev # Runs on port 5173
```

### 📖 API Reference

You can easily use our conjugation engine in your own apps!

**Endpoint:** `GET /api/conjugate`

```bash
curl "http://localhost:3000/api/conjugate?verb=飲む&type=GODAN"
```

**Response:**
```json
{
  "dictionaryForm": "飲む",
  "verbType": "GODAN",
  "negative": "飲まない",
  "polite": "飲みます",
  "teForm": "飲んで",
  "taForm": "飲んだ",
  "potential": "飲める",
  "passive": "飲まれる",
  "causative": "飲ませる",
  "imperative": "飲め",
  "volitional": "飲もう"
}
```

### 🧠 Verb Classification Guide

The engine supports the complete modern Japanese verb classification system:
1. **Godan Verbs (Group 1)**: Endings in う, く, ぐ, す, つ, ぬ, ふ, ぶ, む, る (e.g. 飲む, 書く)
2. **Ichidan Verbs (Group 2)**: Endings in える or いる (e.g. 食べる, 見る)
3. **Suru Verbs (Group 3)**: Endings in する (e.g. 勉強する)
4. **Kuru Verb (Group 3)**: 来る

### 🤝 Contributing

Issues and Pull Requests are very welcome! If you find any edge cases in verb conjugation, or want to add new features (e.g. honorific / humble form generation), feel free to contribute!
See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

### 📄 License

This project is open-sourced under the **MIT License**. Feel free to use, modify, and distribute.

---
<div align="center">
If you find this tool helpful, please give it a ⭐️!
</div>
