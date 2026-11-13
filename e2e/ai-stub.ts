import { createServer, type Server } from "node:http";
import { GOOD_REPLY, HOSTILE_REPLY } from "./ai-fixture";

/** A tiny HTTP server that speaks just enough of the Messages API for the browser tests. Test infrastructure only. */
export function startAiStub(port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        let text = "";
        try { text = JSON.parse(data).messages?.[0]?.content ?? ""; } catch { /* ignore */ }
        const reply = String(text).includes("HALLUCINATE") ? HOSTILE_REPLY : GOOD_REPLY;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply) }] }));
      });
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
