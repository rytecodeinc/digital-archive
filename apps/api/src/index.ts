import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { albumRoutes } from "./routes/albums";
import { mediaRoutes } from "./routes/media";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/api/health", async (c) => {
  const body: Record<string, unknown> = {
    ok: true,
    service: "digital-archive-api",
    bucket: c.env.R2_BUCKET,
    media_bucket: Boolean(c.env.MEDIA_BUCKET),
  };

  if (c.req.query("db") === "1") {
    body.hyperdrive = Boolean(c.env.HYPERDRIVE?.connectionString);
    body.has_database_url = Boolean(c.env.DATABASE_URL);
    try {
      if (!c.env.HYPERDRIVE?.connectionString && !c.env.DATABASE_URL) {
        body.database = "missing_DATABASE_URL";
        body.ok = false;
        body.hint =
          "Bind Cloudflare Hyperdrive as HYPERDRIVE (recommended) or set Worker secret DATABASE_URL.";
      } else {
        const { sql } = await import("./lib/db");
        await sql(c.env)`select 1 as ok`;
        body.database = "ok";
      }
    } catch (err) {
      body.ok = false;
      body.database = "unreachable";
      body.database_error =
        err instanceof Error ? err.message : "unknown database error";
      const message = String(body.database_error);
      if (/too many subrequests/i.test(message)) {
        body.hint =
          "Direct Worker→Postgres is hitting the subrequest limit. Create a Hyperdrive config for Supabase (use the Direct connection string) and bind it to this Worker as HYPERDRIVE.";
      } else {
        body.hint =
          "Prefer Hyperdrive. Or set DATABASE_URL to the Supabase Session pooler URI (aws-...pooler.supabase.com:5432), not db.*.supabase.co.";
      }
    }
  }

  return c.json(body, body.ok ? 200 : 503);
});

app.route("/api/auth", authRoutes);
app.route("/api/owner/media", mediaRoutes);
app.route("/api/owner/albums", albumRoutes);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  const message = err instanceof Error ? err.message : "unknown error";
  // Surface common Workers→Postgres connectivity failures clearly.
  if (
    /cannot connect|proxy request failed|connect_timeout|ENOTFOUND|ECONNREFUSED|too many subrequests/i.test(
      message,
    )
  ) {
    return c.json(
      {
        error: "database_unreachable",
        message,
        hint: /too many subrequests/i.test(message)
          ? "Create Cloudflare Hyperdrive for Supabase (Direct connection string) and bind it to Worker digital-archive as HYPERDRIVE."
          : "Prefer Hyperdrive, or set DATABASE_URL to the Supabase Session pooler URI (aws-...pooler.supabase.com:5432).",
      },
      500,
    );
  }
  return c.json({ error: "internal_error", message }, 500);
});

export default app;
