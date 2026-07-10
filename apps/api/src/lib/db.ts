import postgres from "postgres";
import type { Env } from "../types";

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

/**
 * Create a postgres.js client for this request.
 *
 * Do not cache across requests on Workers: Hyperdrive sockets are request-scoped
 * and reuse throws "Cannot perform I/O on behalf of a different request".
 */
export function sql(env: Env) {
  const viaHyperdrive = Boolean(env.HYPERDRIVE?.connectionString);
  return postgres(connectionString(env), {
    prepare: false,
    max: 1,
    fetch_types: false,
    idle_timeout: 5,
    connect_timeout: 10,
    max_lifetime: 60 * 5,
    // Workers free plan: 50 subrequests. Aggressive reconnects burn that budget.
    backoff: false,
    // Hyperdrive terminates TLS to the origin; do not pass a custom ssl object.
    // Direct DATABASE_URL still needs TLS to Supabase.
    ...(viaHyperdrive ? {} : { ssl: "require" as const }),
  });
}
