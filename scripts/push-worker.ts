import "dotenv/config";
import { dispatchPush, purgePush, pushHealth } from "../src/server/push/dispatch";

// A long-running outbox worker for servers/containers: `npm run push:worker`. On serverless hosts call /api/push/dispatch from a scheduler instead.
const every = Math.max(Number(process.env.PUSH_WORKER_INTERVAL_SECONDS) || 10, 2) * 1000;
let lastPurge = 0;
let stop = false;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stop = true; });

(async () => {
  console.log(`push worker started (every ${every / 1000}s)`);
  while (!stop) {
    try {
      const r = await dispatchPush();
      if (r.claimed) console.log(JSON.stringify(r));
      if (Date.now() - lastPurge > 3600_000) { lastPurge = Date.now(); const n = await purgePush(); if (n) console.log(`purged ${n} old rows`, await pushHealth()); }
    } catch (e) { console.error("push worker pass failed:", (e as Error).message); }
    await new Promise((r) => setTimeout(r, every));
  }
  process.exit(0);
})();
