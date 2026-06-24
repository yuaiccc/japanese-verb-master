# OpenClaw + Feishu + Japanese Verb Master MCP Tutorial

This tutorial connects Japanese Verb Master to OpenClaw as an MCP tool. OpenClaw can receive Feishu messages, and the OpenClaw agent can call this project when a user asks Japanese-learning questions.

## Architecture

```text
Feishu user
  -> OpenClaw Feishu channel
  -> OpenClaw agent
  -> MCP tool: ask_japanese_verb_master
  -> Japanese Verb Master backend /api/agent/run
  -> OpenClaw replies in Feishu
```

The key split:

- Feishu channel: owned by OpenClaw. It solves inbound messages, group policy, permissions, and delivery.
- Japanese Verb Master: owned by this repo. It solves vertical Japanese RAG, memory, grammar tools, and learning advice.
- MCP: the tool boundary between them.

## 1. Start Japanese Verb Master

In one terminal:

```bash
cd /Users/xujunshan/Code/japanese-verb-master/backend
npm start
```

By default the backend listens on:

```text
http://127.0.0.1:3456
```

## 2. Probe the MCP server directly

The MCP server is stdio-based:

```bash
cd /Users/xujunshan/Code/japanese-verb-master/backend
npm run mcp:jvm
```

It exposes two tools:

- `ask_japanese_verb_master`: ask the local Japanese-learning Agent.
- `japanese_verb_master_health`: check whether the backend is reachable.

## 3. Register the MCP server in OpenClaw

Recommended:

```bash
bash /Users/xujunshan/Code/japanese-verb-master/backend/scripts/register-openclaw-mcp.sh
```

Equivalent manual command:

```bash
openclaw mcp add japanese-verb-master \
  --command npx tsx \
  --cwd /Users/xujunshan/Code/japanese-verb-master/backend \
  --arg scripts/jvm-mcp-server.ts \
  --env JVM_AGENT_BASE_URL=http://127.0.0.1:3456
```

If the backend is not running yet, save without probing:

```bash
openclaw mcp add japanese-verb-master \
  --command npx tsx \
  --cwd /Users/xujunshan/Code/japanese-verb-master/backend \
  --arg scripts/jvm-mcp-server.ts \
  --env JVM_AGENT_BASE_URL=http://127.0.0.1:3456 \
  --no-probe
```

Verify:

```bash
openclaw mcp status --verbose
openclaw mcp probe japanese-verb-master
```

Reload MCP runtimes after config changes:

```bash
openclaw mcp reload
```

## 4. Teach OpenClaw when to use it

Send this to your OpenClaw Feishu bot:

```text
你现在有一个 MCP 工具 japanese-verb-master。遇到日语语法、动词变形、词义辨析、例句、记忆复习策略相关问题时，优先调用 ask_japanese_verb_master。先把用户问题原样传给工具，再基于工具结果用中文回答。
```

Example Feishu prompts:

```text
食べる的て形是什么？顺便给我一个记忆方法。
```

```text
教我区分 行く、伺う、参る，最好结合敬语场景。
```

```text
帮我设计今天的日语复习计划，结合我的记忆薄弱点。
```

## 5. Interview explanation

This integration demonstrates a clean enterprise-agent split:

- Channel layer: Feishu/OpenClaw receives messages and handles delivery.
- Gateway/runtime layer: OpenClaw routes the conversation and decides whether to call tools.
- Tool layer: MCP standardizes how an external capability is discovered and called.
- Domain-agent layer: Japanese Verb Master owns RAG, memory, and learning workflow.

The result is different from embedding all logic inside the Feishu bot. The Japanese Agent can still run on Web, CLI, or direct API, while Feishu/OpenClaw becomes just one entry point.
