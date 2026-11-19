// MCP server sidecar: Streamable HTTP on 127.0.0.1:7878/mcp, bearer-token auth.
// Talks to the Tauri app over stdio, one JSON object per line:
//   stdout → app: {type:"notify"|"clear"|"state"|"ready"}   stdin ← app: {op:"read"|"delete"|"clear"}
// Notifications persist in ~/.pet/notifications.json (single writer: this process). Logs go to stderr.
import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PET_MCP_PORT ?? 7878);
const LIST_LIMIT = 20; // list_notifications
const KEEP = 500; // kept on disk for the inbox
const MAX_BODY = 1 << 20;

// ---- token: created once and kept, so registered clients survive restarts; readable only by this user.
// Delete ~/.pet/token (and restart) to rotate it.
const dir = join(homedir(), ".pet");
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(dir, 0o700);
const tokenPath = join(dir, "token");
let token = "";
try { token = readFileSync(tokenPath, "utf8").trim(); } catch { /* first launch */ }
if (!/^[0-9a-f]{64}$/.test(token)) {
  token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, token + "\n", { mode: 0o600 });
}
chmodSync(tokenPath, 0o600);

function authorized(header: string | undefined): boolean {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- notifications ----
type Level = "info" | "success" | "warning" | "error";
interface Notification { id: string; title: string; message: string; level: Level; source?: string; receivedAt: string; read: boolean }

const storePath = join(dir, "notifications.json");
let all: Notification[] = load(); // newest first

function load(): Notification[] {
  try {
    const data = JSON.parse(readFileSync(storePath, "utf8"));
    return Array.isArray(data) ? data.slice(0, KEEP) : [];
  } catch {
    return [];
  }
}
// write to a temp file and rename, so a crash never leaves a half-written store
function save() {
  const tmp = storePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
  renameSync(tmp, storePath);
}
function changed() {
  save();
  toApp({ type: "state", notifications: all });
}

const toApp = (msg: object) => process.stdout.write(JSON.stringify(msg) + "\n");
const log = (...a: unknown[]) => console.error("[pet-mcp]", ...a);
const result = <T extends Record<string, unknown>>(data: T) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: data,
});

function buildServer() {
  const server = new McpServer({ name: "desktop-pet", version: "0.1.0" });

  server.registerTool("notify", {
    title: "Notify the desktop pet",
    description: "Show a notification to the user through the desktop cat. It reacts and shows a speech bubble.",
    inputSchema: {
      title: z.string().min(1).max(200),
      message: z.string().min(1).max(2000),
      level: z.enum(["info", "success", "warning", "error"]).default("info"),
      source: z.string().max(100).optional().describe("Name of the sending tool or project"),
    },
    outputSchema: { id: z.string(), receivedAt: z.string() },
  }, async ({ title, message, level, source }) => {
    const n: Notification = { id: randomUUID(), title, message, level, source, receivedAt: new Date().toISOString(), read: false };
    all.unshift(n);
    all.length = Math.min(all.length, KEEP);
    toApp({ type: "notify", notification: n });
    changed();
    return result({ id: n.id, receivedAt: n.receivedAt });
  });

  server.registerTool("list_notifications", {
    title: "List recent notifications",
    description: `Return the ${LIST_LIMIT} most recent notifications, newest first.`,
    outputSchema: { notifications: z.array(z.object({
      id: z.string(), title: z.string(), message: z.string(),
      level: z.enum(["info", "success", "warning", "error"]), source: z.string().optional(), receivedAt: z.string(),
      read: z.boolean(),
    })) },
  }, async () => result({ notifications: all.slice(0, LIST_LIMIT) }));

  server.registerTool("clear_notifications", {
    title: "Clear notifications",
    description: "Remove all stored notifications and dismiss the pet's speech bubble.",
    outputSchema: { cleared: z.number() },
  }, async () => {
    const cleared = all.length;
    all = [];
    toApp({ type: "clear" });
    changed();
    return result({ cleared });
  });

  return server;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const http = createServer(async (req, res) => {
  const json = (code: number, body: object, headers: Record<string, string> = {}) =>
    res.writeHead(code, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));

  if (new URL(req.url ?? "/", "http://x").pathname !== "/mcp") return json(404, { error: "not found" });
  if (!authorized(req.headers.authorization)) return json(401, { error: "unauthorized" }, { "WWW-Authenticate": 'Bearer realm="pet"' });

  let body: unknown;
  if (req.method === "POST") {
    try { body = await readJson(req); } catch { return json(400, { error: "invalid JSON body" }); }
  }

  // Stateless: a fresh server + transport per request.
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true, // reject Host headers other than our own (DNS rebinding)
    allowedHosts: [`127.0.0.1:${PORT}`, `localhost:${PORT}`],
  });
  res.on("close", () => { void transport.close(); void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    log("request failed:", e);
    if (!res.headersSent) json(500, { error: "internal error" });
  }
});

http.on("error", (e: NodeJS.ErrnoException) => {
  const message = e.code === "EADDRINUSE" ? `포트 ${PORT}을(를) 다른 프로그램이 사용 중` : e.message;
  log("server error:", message);
  toApp({ type: "error", message });
  process.exit(1);
});
http.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}/mcp, token in ${tokenPath}`);
  toApp({ type: "ready", port: PORT });
  toApp({ type: "state", notifications: all });
});

// ---- inbox actions from the app ----
interface Op { op: "read" | "delete" | "clear"; ids?: string[]; source?: string; all?: boolean }
const sourceOf = (n: Notification) => n.source ?? "";
const matches = (op: Op, n: Notification) =>
  op.all === true || (op.ids?.includes(n.id) ?? false) || (op.source !== undefined && sourceOf(n) === op.source);

createInterface({ input: process.stdin })
  .on("line", (line) => {
    let op: Op;
    try { op = JSON.parse(line); } catch { return log("bad op:", line); }
    if (op.op === "read") all.forEach((n) => { if (matches(op, n)) n.read = true; });
    else if (op.op === "delete" || op.op === "clear") {
      all = all.filter((n) => !matches(op, n));
      if (all.length === 0) toApp({ type: "clear" });
    } else return log("unknown op:", op.op);
    changed();
  })
  // The app keeps our stdin open; when it goes away, so do we (no orphaned server).
  .on("close", () => process.exit(0));
