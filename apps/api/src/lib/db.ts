import postgres from "postgres";
import type { Env } from "../types";

const clients = new WeakMap<object, ReturnType<typeof postgres>>();

export function sql(env: Env) {
  let client = clients.get(env);
  if (!client) {
    // Workers/local may sit behind TLS inspection; rejectUnauthorized:false
    // still encrypts the connection. Prefer pooler URI in DATABASE_URL.
    client = postgres(env.DATABASE_URL, {
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
