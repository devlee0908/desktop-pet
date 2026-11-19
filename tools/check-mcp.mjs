// node tools/check-mcp.mjs — end-to-end check against the running app (needs the pet running).
// Same transport Claude Code uses for `--transport http`, with the bearer header.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const token = readFileSync(`${homedir()}/.pet/token`, "utf8").trim();
const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:7878/mcp"), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "check", version: "1" });
await client.connect(transport);
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const r = await client.callTool({ name: "notify", arguments: { title: "빌드 완료", message: "desktop-pet 테스트 12개 통과", level: "success", source: "Claude Code" } });
console.log("notify →", JSON.stringify(r.structuredContent));
const r2 = await client.callTool({ name: "notify", arguments: { title: "배포 실패", message: "staging health check timeout", level: "error", source: "CI" } });
console.log("notify(error) →", JSON.stringify(r2.structuredContent));
const l = await client.callTool({ name: "list_notifications", arguments: {} });
console.log("list →", l.structuredContent.notifications.length, "items");
await client.close();
// and without the token it must fail
try { const c2 = new Client({ name: "x", version: "1" }); await c2.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:7878/mcp"))); console.log("UNEXPECTED: connected without token"); }
catch (e) { console.log("no token →", String(e.message ?? e).slice(0, 80)); }
