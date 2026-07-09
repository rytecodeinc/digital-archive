import { Hono } from "hono";
import type { Env } from "../types";
import { sql } from "../lib/db";
import {
  createSession,
  destroySession,
  requireOwner,
  verifyPassword,
} from "../lib/auth";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";

  if (!email || !password) {
    return c.json({ error: "email and password required" }, 400);
  }

  const rows = await sql(c.env)`
    select id, email, display_name, password_hash
    from users
    where email = ${email}
    limit 1
  `;

  const user = rows[0] as
    | {
        id: string;
        email: string;
        display_name: string;
        password_hash: string | null;
      }
    | undefined;

  if (!user?.password_hash) {
    return c.json({ error: "invalid credentials" }, 401);
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return c.json({ error: "invalid credentials" }, 401);
  }

  const archiveRows = await sql(c.env)`
    select id from archives where owner_user_id = ${user.id} limit 1
  `;
  if (!archiveRows.length) {
    return c.json({ error: "no archive for user" }, 403);
  }

  await createSession(c, user.id);
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
    },
  });
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;
  return c.json({
    user: {
      id: owner.user.id,
      email: owner.user.email,
      display_name: owner.user.display_name,
    },
    archive: {
      id: owner.archive.id,
      title: owner.archive.title,
    },
  });
});
