// FLOP Chat: a small Vietnamese chatbot that answers through the FLOP devnet gateway.
// Runs on this PC only (http://127.0.0.1:3000). The gateway key never reaches the browser.
//
//   1. once:  npx.cmd --yes @flop-labs/cli@0.4.4 --network devnet agent credential
//   2. then:  node server.mjs        and open http://127.0.0.1:3000
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlopClient, FlopHTTPError } from "@flop-labs/client";

const PORT = Number(process.env.PORT || 3000);
const GATEWAY = "https://api.flop.network";
const KEY_FILE = process.env.FLOP_KEY_FILE || path.join(os.homedir(), ".flop", "devnet-wallet-agent-key.json");
const MAX_TOKENS = 400;
const SYSTEM = "Bạn là trợ lý AI thân thiện. Luôn trả lời bằng tiếng Việt, ngắn gọn, rõ ràng. " +
  "Nếu không chắc chắn thì nói là không chắc.";
const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadCredential() {
  // Written by the official CLI: { gateway, key, model, ... }. Only `key` is secret.
  if (!fs.existsSync(KEY_FILE)) return null;
  const c = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
  if (!c.key?.startsWith("flop_") || !c.model) throw new Error(`unexpected credential file ${KEY_FILE}`);
  return c;
}

function publicInfo(c) {
  // everything in the credential file except the key itself
  if (!c) return { ready: false, keyFile: KEY_FILE };
  const { key, ...rest } = c;
  return { ready: true, ...rest };
}

let busy = false;   // one paid request at a time; never retried automatically

async function chat(body) {
  const cred = loadCredential();
  if (!cred) return [400, { error: "Chưa có khóa gateway. Chạy lệnh 'agent credential' trước (xem README)." }];
  const history = Array.isArray(body.messages) ? body.messages : [];
  const messages = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") return [400, { error: "Không có câu hỏi." }];
  if (busy) return [429, { error: "Đang chờ câu trả lời trước, vui lòng đợi." }];
  busy = true;
  const started = Date.now();
  try {
    const client = new FlopClient({ baseURL: cred.gateway || GATEWAY, apiKey: cred.key });
    const res = await client.createChatCompletion({
      model: cred.model,
      messages: [{ role: "system", content: SYSTEM }, ...messages],
      max_tokens: MAX_TOKENS,
      temperature: 0.7,
      stream: false,
    }, { signal: AbortSignal.timeout(90_000) });
    const reply = res.choices?.[0]?.message?.content ?? "";
    return [200, {
      reply, model: res.model, usage: res.usage ?? null,
      receipt: res.x_flop_receipt ?? null, ms: Date.now() - started,
    }];
  } catch (e) {
    if (e instanceof FlopHTTPError) {
      const why = e.status === 429 ? "Gateway đang quá tải hoặc bạn gửi quá nhanh. Thử lại sau ít phút."
        : e.status === 401 || e.status === 403 ? "Khóa gateway hết hạn hoặc hết hạn mức (khóa devnet chỉ dùng ~24 giờ). Chạy lại lệnh 'agent credential'."
        : `Gateway trả lỗi HTTP ${e.status}.`;
      return [502, { error: why, status: e.status, retryAfter: e.retryAfter ?? null }];
    }
    return [502, { error: `Không gọi được gateway: ${e.name}: ${String(e.message).slice(0, 200)}` }];
  } finally {
    busy = false;
  }
}

function send(res, code, type, body) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(path.join(HERE, "index.html")));
    }
    if (req.method === "GET" && url.pathname === "/api/info") {
      return send(res, 200, "application/json", JSON.stringify(publicInfo(loadCredential())));
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) return send(res, 413, "text/plain", "too large"); }
      const [code, out] = await chat(JSON.parse(raw || "{}"));
      return send(res, code, "application/json", JSON.stringify(out));
    }
    send(res, 404, "text/plain", "not found");
  } catch (e) {
    send(res, 500, "application/json", JSON.stringify({ error: String(e.message || e).slice(0, 200) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const info = publicInfo(loadCredential());
  console.log(`FLOP Chat: http://127.0.0.1:${PORT}`);
  console.log(info.ready ? `gateway key found, model ${info.model}` : `no gateway key yet (${KEY_FILE}); see README`);
});
