import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is required.\n" +
      "Use the Supabase Postgres URI from Project Settings → Database → Connect\n" +
      "(not https://xxxx.supabase.co). Example:\n" +
      "postgresql://postgres.PROJECTREF:DB_PASSWORD@aws-1-REGION.pooler.supabase.com:5432/postgres",
  );
  process.exit(1);
}

const migrationsDir = join(root, "packages/db/migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
await client.query(`
  create table if not exists schema_migrations (
    id text primary key,
    applied_at timestamptz not null default now()
  )
`);

for (const file of files) {
  const id = file;
  const { rows } = await client.query(
    "select 1 from schema_migrations where id = $1",
    [id],
  );
  if (rows.length) {
    console.log("skip", id);
    continue;
  }
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  console.log("apply", id);
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into schema_migrations (id) values ($1)", [id]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

await client.end();
console.log("migrations complete");
