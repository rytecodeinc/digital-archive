import bcrypt from "bcryptjs";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env, UserRow, ArchiveRow } from "../types";
import { sql } from "./db";

const SESSION_COOKIE = "da_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

async function sha256(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(c: Context<{ Bindings: Env }>, userId: string) {
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await sql(c.env)`
    insert into sessions (user_id, token_hash, expires_at)
    values (${userId}, ${tokenHash}, ${expiresAt.toISOString()})
  `;

  const secure = new URL(c.req.url).protocol === "https:";
  const origin = c.req.header("Origin");
  let sameSite: "Lax" | "None" = "Lax";
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(c.req.url).host) {
        // Pages (pages.dev) calling Worker (workers.dev) is cross-site.
        sameSite = "None";
      }
    } catch {
      // keep Lax
    }
  }

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secure || sameSite === "None",
    sameSite,
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(c: Context<{ Bindings: Env }>) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const tokenHash = await sha256(token);
    await sql(c.env)`
      update sessions set revoked_at = now()
      where token_hash = ${tokenHash} and revoked_at is null
    `;
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export type OwnerContext = {
  user: UserRow;
  archive: ArchiveRow;
};

export async function requireOwner(
  c: Context<{ Bindings: Env }>,
): Promise<OwnerContext | Response> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const tokenHash = await sha256(token);
  const rows = await sql(c.env)`
    select
      u.id,
      u.email,
      u.display_name,
      u.password_hash,
      a.id as archive_id,
      a.owner_user_id,
      a.title as archive_title
    from sessions s
    join users u on u.id = s.user_id
    join archives a on a.owner_user_id = u.id
    where s.token_hash = ${tokenHash}
      and s.revoked_at is null
      and s.expires_at > now()
    limit 1
  `;

  if (!rows.length) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const row = rows[0] as {
    id: string;
    email: string;
    display_name: string;
    password_hash: string | null;
    archive_id: string;
    owner_user_id: string;
    archive_title: string;
  };

  return {
    user: {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      password_hash: row.password_hash,
    },
    archive: {
      id: row.archive_id,
      owner_user_id: row.owner_user_id,
      title: row.archive_title,
    },
  };
}
