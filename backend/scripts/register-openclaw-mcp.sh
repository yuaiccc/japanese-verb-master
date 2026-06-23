#!/usr/bin/env bash
set -euo pipefail

JVM_BACKEND_DIR="/Users/xujunshan/Code/japanese-verb-master/backend"
JVM_AGENT_BASE_URL="${JVM_AGENT_BASE_URL:-http://127.0.0.1:3456}"

openclaw mcp add japanese-verb-master \
  --command node \
  --cwd "$JVM_BACKEND_DIR" \
  --arg scripts/jvm-mcp-server.js \
  --env "JVM_AGENT_BASE_URL=$JVM_AGENT_BASE_URL" \
  --no-probe

openclaw mcp reload

echo "Registered japanese-verb-master MCP server for OpenClaw."
echo "Start backend with: cd $JVM_BACKEND_DIR && npm start"
echo "Verify with: openclaw mcp probe japanese-verb-master"
