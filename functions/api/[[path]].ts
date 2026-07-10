const WORKER_ORIGIN = "https://digital-archive.rytecode.workers.dev";

/**
 * Proxy /api/* from Pages (same origin) to the API Worker so session cookies
 * stay on *.pages.dev and login works without cross-site cookie issues.
 */
export const onRequest: PagesFunction = async (context) => {
  const incoming = new URL(context.request.url);
  const target = new URL(
    `${incoming.pathname}${incoming.search}`,
    WORKER_ORIGIN,
  );

  const headers = new Headers(context.request.headers);
  headers.delete("host");

  return fetch(
    new Request(target.toString(), {
      method: context.request.method,
      headers,
      body: context.request.body,
      redirect: "manual",
    }),
  );
};
