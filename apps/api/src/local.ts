/**
 * Local Node server for development when `wrangler dev` cannot
 * complete TLS to Postgres (e.g. environments with TLS inspection).
 * Production still deploys as a Cloudflare Worker via `wrangler deploy`.
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import app from "./index";
import type { Env } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDevVars() {
  const path = resolve(__dirname, "../.dev.vars");
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
    // optional if env already set
  }
}

loadDevVars();

const env: Env = {
  DATABASE_URL: process.env.DATABASE_URL || "",
  R2_BUCKET: process.env.R2_BUCKET || "digital-archive-media",
  CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID || "75d07e9024b11886801cce0718edc814",
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || "",
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || "",
  SESSION_SECRET: process.env.SESSION_SECRET || "",
  OWNER_EMAIL: process.env.OWNER_EMAIL || "rinarasia@icloud.com",
};

for (const key of [
  "DATABASE_URL",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "SESSION_SECRET",
] as const) {
  if (!env[key]) {
    console.error(`Missing ${key}. Set it in apps/api/.dev.vars`);
    process.exit(1);
  }
}

const port = Number(process.env.PORT || 8787);

serve(
  {
    fetch: (request) => app.fetch(request, env),
    port,
  },
  (info) => {
    console.log(`digital-archive-api (node) listening on http://127.0.0.1:${info.port}`);
  },
);
