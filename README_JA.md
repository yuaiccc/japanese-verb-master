<div align="center">

# 🌸 Japanese Verb Master（日本語動詞活用マスター）

[![Vue 3](https://img.shields.io/badge/Vue.js-3.0-4FC08D?style=for-the-badge&logo=vue.js)](https://vuejs.org/)
[![Express](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express)](https://expressjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge)](http://makeapullrequest.com)

**正確で使いやすい日本語動詞活用オンラインツール＆RESTful API。**

[简体中文](./README.md) | [English](./README_EN.md)

</div>

---

### ✨ 特徴

- 🎯 **高精度**：五段動詞、一段動詞、不規則動詞（サ変・カ変）の活用規則を完全サポート。
- ⚡ **リアルタイム**：Vue 3 + Vite で構築されたフロントエンドにより、スムーズな操作体験を実現。
- 📚 **網羅的**：て形、た形、受身形、使役形、可能形など、10種類以上の活用形式をワンクリックで生成。
- 🤖 **AI 分析機能**：Ollama ローカルモデルを統合し、活用結果の自動検証と例文生成を実現。
- 🔌 **すぐ使える API**：Express による軽量な RESTful API を提供。他のアプリケーションとの連携も簡単。
- 📱 **レスポンシブデザイン**：スマートフォンでもPCでも快適に利用可能。

### 🚀 クイックスタート

#### 1. リポジトリをクローン
```bash
git clone https://github.com/yuaiccc/japanese-verb-master.git
cd japanese-verb-master
```

#### 2. バックエンドを起動
```bash
cd backend
npm install
npm run dev # ポート3000で起動
```

#### 3. フロントエンドを起動
```bash
cd frontend
npm install
npm run dev # ポート5173で起動
```

### 📖 API リファレンス

本プロジェクトの活用エンジンを、あなた自身のアプリで簡単に利用できます！

**エンドポイント：** `GET /api/conjugate`

```bash
curl "http://localhost:3000/api/conjugate?verb=飲む&type=GODAN"
```

**レスポンス：**
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

### 🧠 動詞分類ガイド

本エンジンは現代日本語の動詞分類体系を完全にサポートしています：
1. **五段動詞（Group 1）**：語尾が う、く、ぐ、す、つ、ぬ、ふ、ぶ、む、る（例：飲む、書く）
2. **一段動詞（Group 2）**：語尾が える または いる（例：食べる、見る）
3. **サ変動詞（Group 3）**：語尾が する（例：勉強する）
4. **カ変動詞（Group 3）**：来る

### 🤝 コントリビューション

Issue や Pull Request を大歓迎しています！動詞活用のエッジケースを発見した場合や、新機能（敬語・謙譲語の生成など）を追加したい場合は、お気軽にご参加ください！
詳細は [CONTRIBUTING.md](CONTRIBUTING.md) をご参照ください。

### 📄 ライセンス

本プロジェクトは **MIT License** の下でオープンソースとして公開されています。自由にご利用・改変・再配布いただけます。

---
<div align="center">
このツールが役に立ったら、ぜひ ⭐️ をお願いします！
</div>
