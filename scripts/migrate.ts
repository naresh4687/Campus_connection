import "dotenv/config";
import { migrate } from "../db/migrator";

const target = process.argv[2] === "test" ? "TEST_MIGRATE_DATABASE_URL" : "MIGRATE_DATABASE_URL";
const url = process.env[target];
if (!url) {
  console.error(`${target} is not set`);
  process.exit(1);
}
migrate(url)
  .then((r) => {
    console.log(`applied: ${r.applied.join(", ") || "(none)"}`);
    console.log(`already applied: ${r.alreadyApplied.join(", ") || "(none)"}`);
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
