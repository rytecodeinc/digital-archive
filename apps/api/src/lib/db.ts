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

function connectionString(env: Env) {
  // Prefer Hyperdrive when bound — required for reliable Postgres from Workers.
  const hyperdrive = env.HYPERDRIVE?.connectionString;
  if (hyperdrive) return hyperdrive;
  if (!env.DATABASE_URL) {
    throw new Error(
      "No database binding: set Worker secret DATABASE_URL or bind Hyperdrive as HYPERDRIVE",
    );
  }
  return normalizeDatabaseUrl(env.DATABASE_URL);
}

export function sql(env: Env) {
  let client = clients.get(env);
  if (!client) {
    const viaHyperdrive = Boolean(env.HYPERDRIVE?.connectionString);
    // Workers: keep a single connection, skip type OID fetch (extra round-trips /
    // subrequests), and avoid custom SSL objects that can retry-storm.
    client = postgres(connectionString(env), {
      prepare: false,
      max: 1,
      fetch_types: false,
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 60 * 30,
      // Workers free plan: 50 subrequests. Aggressive reconnects burn that budget.
      backoff: false,
      // Hyperdrive terminates TLS to the origin; do not pass a custom ssl object.
      // Direct DATABASE_URL still needs TLS to Supabase.
      ...(viaHyperdrive ? {} : { ssl: "require" as const }),
    });
    clients.set(env, client);
  }
  return client;
}
