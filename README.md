<div align="center">

# 🌸 Japanese Verb Master (日语动词活用专家)

[![Vue 3](https://img.shields.io/badge/Vue.js-3.0-4FC08D?style=for-the-badge&logo=vue.js)](https://vuejs.org/)
[![Express](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express)](https://expressjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge)](http://makeapullrequest.com)

**The ultimate, precise Japanese verb conjugation tool and API.**
<br>
**一个精准、优雅的日语动词活用在线工具与 RESTful API。**

[English](#english) • [简体中文](#简体中文)

</div>

---

<h2 id="english">🇬🇧 English</h2>

### ✨ Features

- 🎯 **High Accuracy**: Precise conjugation rules for Godan, Ichidan, and Irregular verbs.
- ⚡ **Real-time**: Instant results powered by a modern Vue 3 frontend.
- 📚 **Comprehensive**: Covers 10+ forms including Te-form, Ta-form, Passive, Causative, Potential, and more.
- 🔌 **REST API**: Built-in Express backend providing clean JSON APIs for other developers to build upon.
- 📱 **Responsive Design**: Works perfectly on mobile and desktop.

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

---

<h2 id="简体中文">🇨🇳 简体中文</h2>

### ✨ 项目特色

- 🎯 **极高准确率**：完美支持五段动词、一段动词及各类不规则动词（サ变、カ变）的变形规则。
- ⚡ **极致响应**：基于 Vue 3 + Vite 构建的前端，提供丝滑的实时交互体验。
- 📚 **全面覆盖**：一键生成 10+ 种常用活用形式（包含て形、た形、被动、使役、可能形等）。
- 🔌 **开箱即用的 API**：提供轻量级的 Express RESTful API，方便其他开发者接入自己的应用。
- 📱 **响应式设计**：无论是手机背单词还是电脑查资料，都有完美的视觉体验。

### 🚀 快速开始

#### 1. 克隆项目
```bash
git clone https://github.com/yuaiccc/japanese-verb-master.git
cd japanese-verb-master
```

#### 2. 启动后端服务
```bash
cd backend
npm install
npm run dev # 默认运行在 3000 端口
```

#### 3. 启动前端页面
```bash
cd frontend
npm install
npm run dev # 默认运行在 5173 端口
```

### 📖 API 接入文档

你可以直接调用本项目的 API 来开发你自己的日语学习工具！

**请求接口：** `GET /api/conjugate`

```bash
curl "http://localhost:3000/api/conjugate?verb=食べる&type=ICHIDAN"
```

**返回结果：**
```json
{
  "dictionaryForm": "食べる",
  "verbType": "ICHIDAN",
  "negative": "食べない",
  "polite": "食べます",
  "teForm": "食べて",
  "taForm": "食べた",
  "potential": "食べられる",
  "passive": "食べられる",
  "causative": "食べさせる",
  "imperative": "食べろ",
  "volitional": "食べよう"
}
```

### 🧠 动词分类指南

本项目引擎支持完整的现代日语动词分类体系：
1. **五段动词 (Godan / Group 1)**：词尾为 う、く、ぐ、す、つ、ぬ、ふ、ぶ、む、る（例：飲む、書く）
2. **一段动词 (Ichidan / Group 2)**：词尾为 える、いる（例：食べる、見る）
3. **サ变动词 (Group 3)**：词尾为 する（例：勉強する）
4. **カ变动词 (Group 3)**：来る

## 🤝 参与贡献 (Contributing)

非常欢迎提交 Issue 和 Pull Request！如果你发现了任何动词变形的 Edge Case，或者想添加新的特性（如敬语/谦让语生成），请随时参与进来！
详细指南请参考 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 📄 开源协议

本项目基于 **MIT License** 开源。欢迎自由使用、修改和分发。

---
<div align="center">
If you find this tool helpful, please give it a ⭐️! <br>
如果这个工具对你有帮助，请给它点个 ⭐️ 吧！
</div>
