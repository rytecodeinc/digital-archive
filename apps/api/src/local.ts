/**
 * Local Node server for development when `wrangler dev` cannot
 * complete TLS to Postgres (e.g. environments with TLS inspection).
 * Also serves the built web UI so a single public tunnel URL works.
 * Production still deploys as a Cloudflare Worker via `wrangler deploy`.
 */
import { serve } from "@hono/node-server";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import app from "./index";
import type { Env } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");
const webDist = join(root, "apps/web/dist");

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

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function safeJoin(base: string, requestPath: string) {
  const cleaned = requestPath.replace(/^\/+/, "");
  const full = resolve(base, cleaned);
  if (!full.startsWith(resolve(base))) return null;
  return full;
}

if (existsSync(webDist)) {
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api")) return next();

    // SPA routes (including `/`) fall through to index.html
    if (c.req.path === "/" || !c.req.path.includes(".")) {
      const index = join(webDist, "index.html");
      if (!existsSync(index)) return c.text("Web UI not built", 404);
      return c.html(readFileSync(index, "utf8"));
    }

    const assetPath = safeJoin(webDist, c.req.path);
    if (
      assetPath &&
      existsSync(assetPath) &&
      statSync(assetPath).isFile()
    ) {
      const body = readFileSync(assetPath);
      const type = mimeTypes[extname(assetPath)] || "application/octet-stream";
      return c.body(body, 200, { "Content-Type": type });
    }

    const index = join(webDist, "index.html");
    if (!existsSync(index)) return c.text("Web UI not built", 404);
    return c.html(readFileSync(index, "utf8"));
  });
  console.log(`Serving web UI from ${webDist}`);
} else {
  console.warn(
    `Web UI not found at ${webDist}. Run: npm run build -w @digital-archive/web`,
  );
}

const port = Number(process.env.PORT || 8787);

serve(
  {
    fetch: (request) => app.fetch(request, env),
    port,
  },
  (info) => {
    console.log(
      `digital-archive (api+web) listening on http://127.0.0.1:${info.port}`,
    );
  },
);
