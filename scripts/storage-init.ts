import "dotenv/config";
import { ensureBucket } from "../src/server/storage/s3";

ensureBucket().then(() => console.log("storage bucket ready")).catch((e) => { console.error("storage init failed:", e.message); process.exit(1); });
