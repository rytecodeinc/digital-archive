import postgres from "postgres";
import type { Env } from "../types";

const clients = new WeakMap<object, ReturnType<typeof postgres>>();

/** Ensure password special characters are percent-encoded for postgres.js / Workers. */
export function normalizeDatabaseUrl(raw: string) {
  const trimmed = raw.trim();
  try {
    const parsed = new URL(trimmed);
    if (!parsed.password) return trimmed;
    const decode = (value: string) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };
    // Re-encode username/password so values like `!` survive secret paste.
    const user = encodeURIComponent(decode(parsed.username));
    const pass = encodeURIComponent(decode(parsed.password));
    return `${parsed.protocol}//${user}:${pass}@${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

export function sql(env: Env) {
  let client = clients.get(env);
  if (!client) {
    // Workers/local may sit behind TLS inspection; rejectUnauthorized:false
    // still encrypts the connection. Prefer pooler URI in DATABASE_URL.
    client = postgres(normalizeDatabaseUrl(env.DATABASE_URL), {
      prepare: false,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: { rejectUnauthorized: false },
    });
    clients.set(env, client);
  }
  return client;
}
