import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import bcrypt from "bcryptjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvFile(path) {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

loadEnvFile(join(root, ".env"));
loadEnvFile(join(root, "apps/api/.dev.vars"));

const databaseUrl = process.env.DATABASE_URL;
const email = (process.env.OWNER_EMAIL || "rinarasia@icloud.com").toLowerCase();
const password = process.env.OWNER_PASSWORD;

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if (!password) {
  console.error("OWNER_PASSWORD is required (app login password, not DB password)");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const passwordHash = await bcrypt.hash(password, 12);
const displayName = email.split("@")[0];

await client.query("begin");
try {
  const existing = await client.query("select id from users where email = $1", [
    email,
  ]);

  let userId;
  if (existing.rows.length) {
    userId = existing.rows[0].id;
    await client.query(
      "update users set password_hash = $2, display_name = coalesce(display_name, $3), updated_at = now() where id = $1",
      [userId, passwordHash, displayName],
    );
    console.log("updated owner user", email);
  } else {
    const inserted = await client.query(
      `insert into users (email, display_name, password_hash)
       values ($1, $2, $3)
       returning id`,
      [email, displayName, passwordHash],
    );
    userId = inserted.rows[0].id;
    console.log("created owner user", email);
  }

  const archive = await client.query(
    "select id from archives where owner_user_id = $1 limit 1",
    [userId],
  );
  if (!archive.rows.length) {
    await client.query(
      `insert into archives (owner_user_id, title) values ($1, $2)`,
      [userId, "Travel Archive"],
    );
    console.log("created archive");
  } else {
    console.log("archive already exists");
  }

  await client.query("commit");
} catch (err) {
  await client.query("rollback");
  throw err;
}

await client.end();
console.log("seed complete");
