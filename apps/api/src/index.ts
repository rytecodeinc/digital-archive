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
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "digital-archive-api",
    bucket: c.env.R2_BUCKET,
  }),
);

app.route("/api/auth", authRoutes);
app.route("/api/owner/media", mediaRoutes);
app.route("/api/owner/albums", albumRoutes);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error", message: err.message }, 500);
});

export default app;
