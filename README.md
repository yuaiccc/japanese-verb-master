# Japanese Verb Master - 日语动词活用专家

一个基于 Vue3 + Express 的精准日语动词活用在线工具和文档网站。

## 项目特色

- **Vue3 前端**：现代化的前端框架，提供流畅的用户体验
- **Express 后端**：轻量级的 Node.js 服务器，提供 RESTful API
- **完整的活用规则**：支持五段、一段及不规则动词的自动变换
- **交互式文档**：集成动词分类指南和活用形式说明

## 项目结构

```
japanese-verb-master/
├── backend/              # Express 后端服务
│   ├── server.js        # 主服务器文件
│   ├── conjugationEngine.js  # 动词活用逻辑
│   └── package.json
├── frontend/            # Vue3 前端应用
│   ├── src/
│   │   ├── App.vue      # 主应用组件
│   │   └── main.js      # 入口文件
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── README.md
```

## 快速开始

### 安装依赖

```bash
# 后端
cd backend
npm install

# 前端
cd ../frontend
npm install
```

### 启动开发服务器

**终端 1 - 启动后端：**
```bash
cd backend
npm run dev
# 或
npm start
```

**终端 2 - 启动前端：**
```bash
cd frontend
npm run dev
```

前端将在 `http://localhost:5173` 启动，自动代理 API 请求到后端。

## API 文档

### 获取动词活用

**请求：**
```
GET /api/conjugate?verb=飲む&type=GODAN
```

**响应：**
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

### 获取支持的动词类型

**请求：**
```
GET /api/verb-types
```

**响应：**
```json
{
  "types": [
    {
      "id": "GODAN",
      "name": "五段动词 (Group 1)",
      "description": "Verbs ending in う, く, ぐ, す, つ, ぬ, ふ, ぶ, む, る"
    },
    ...
  ]
}
```

## 动词分类

### 五段动词 (Godan - Group 1)
动词词尾为：う、く、ぐ、す、つ、ぬ、ふ、ぶ、む、る

例：飲む、読む、書く、走る

### 一段动词 (Ichidan - Group 2)
动词词尾为：える、いる

例：食べる、見る、寝る

### サ变动词 (Group 3)
动词词尾为：する

例：勉強する、仕事する、愛する

### カ变动词 (Group 3)
动词词尾为：来る

例：来る

## 活用形式

| 形式 | 说明 | 例子 |
|------|------|------|
| 原形 | 字典形式 | 飲む |
| 否定式 | 表示否定 | 飲まない |
| 礼貌式 | 正式、礼貌的表达 | 飲みます |
| て形 | 连接动作或请求 | 飲んで |
| 过去式 | 过去的动作或状态 | 飲んだ |
| 可能形 | 能力或可能性 | 飲める |
| 被动形 | 被动语态 | 飲まれる |
| 使役形 | 使役关系 | 飲ませる |
| 命令形 | 命令或指示 | 飲め |
| 意向形 | 意图或推测 | 飲もう |

## 技术栈

- **前端**：Vue 3, Vite, Axios
- **后端**：Node.js, Express, CORS
- **开发工具**：npm, ES6 modules

## 生产构建

### 前端构建

```bash
cd frontend
npm run build
```

构建输出将在 `dist/` 目录中。

### 后端部署

后端可以直接运行 `npm start` 或通过 PM2 等进程管理器部署。

## 许可证

MIT
