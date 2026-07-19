#!/usr/bin/env bash
# Ítem 2 — PAYLOAD-LIMIT-REST: ~6MB y ~60MB contra REST, y ~6MB contra /mcp (5MB)
set -u
cd "$(dirname "$0")"
BASE="http://localhost:3002"
H1="Content-Type: application/json"
H2="x-api-key: dev-key"
H3="X-Forwarded-For: 10.66.1.2"

echo "== generando payloads =="
node -e '
const fs = require("fs");
const six = JSON.stringify({ name: "qa-payload-6mb", workspaceId: "ws_qa_verify", engine: "html", html: "<div>" + "A".repeat(6 * 1024 * 1024) + "</div>", css: "" });
fs.writeFileSync("payload-6mb.json", six);
console.log("payload-6mb.json bytes:", Buffer.byteLength(six));
const sixty = JSON.stringify({ name: "qa-payload-60mb", workspaceId: "ws_qa_verify", engine: "html", html: "<div>" + "B".repeat(60 * 1024 * 1024) + "</div>", css: "" });
fs.writeFileSync("payload-60mb.json", sixty);
console.log("payload-60mb.json bytes:", Buffer.byteLength(sixty));
const mcpSix = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "update_template", arguments: { id: "tpl_inexistente", html: "C".repeat(6 * 1024 * 1024) } } });
fs.writeFileSync("payload-mcp-6mb.json", mcpSix);
console.log("payload-mcp-6mb.json bytes:", Buffer.byteLength(mcpSix));
'

echo
echo "== [1] POST /api/templates con ~6MB (bajo el límite de 50mb de Express) =="
curl -s -m 60 -o resp-6mb.txt -w "HTTP %{http_code} | %{size_upload} bytes subidos | %{size_download} bytes respuesta\n" \
  -H "$H1" -H "$H2" -H "$H3" --data-binary @payload-6mb.json "$BASE/api/templates"
echo "respuesta (truncada):"; head -c 200 resp-6mb.txt; echo

echo
echo "== [2] POST /api/templates con ~60MB (sobre el límite de 50mb) =="
curl -s -m 120 -o resp-60mb.txt -w "HTTP %{http_code} | %{size_upload} bytes subidos | %{size_download} bytes respuesta\n" \
  -H "$H1" -H "$H2" -H "$H3" --data-binary @payload-60mb.json "$BASE/api/templates"
echo "Content-Type de la respuesta:"; curl -s -m 120 -o /dev/null -D - -H "$H1" -H "$H2" -H "$H3" --data-binary @payload-60mb.json "$BASE/api/templates" | grep -iE '^HTTP|content-type|x-ratelimit' 
echo "cuerpo (truncado, 400 chars):"; head -c 400 resp-60mb.txt; echo

echo
echo "== [3] POST /mcp con ~6MB (límite MCP = 5MB) =="
curl -s -m 60 -o resp-mcp-6mb.txt -w "HTTP %{http_code} | %{size_upload} bytes subidos\n" \
  -H "$H1" -H "$H2" -H "$H3" --data-binary @payload-mcp-6mb.json "$BASE/mcp"
echo "respuesta (truncada):"; head -c 350 resp-mcp-6mb.txt; echo

rm -f payload-6mb.json payload-60mb.json payload-mcp-6mb.json resp-6mb.txt resp-60mb.txt resp-mcp-6mb.txt
echo
echo "== payloads temporales eliminados =="
