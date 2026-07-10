const PROD_WORKER_ORIGIN = "https://digital-archive.rytecode.workers.dev";
const WORKER_NAME = "digital-archive";
const WORKERS_SUBDOMAIN = "rytecode.workers.dev";

/**
 * Resolve which Worker origin should handle this Pages request.
 *
 * Production Pages (`main`) → production Worker.
 * Branch / commit previews → matching Workers Builds branch preview alias,
 * so new API routes (e.g. /info) are available before merge.
 */
function workerOrigin(env: Record<string, unknown> | undefined): string {
  const branch =
    typeof env?.CF_PAGES_BRANCH === "string" ? env.CF_PAGES_BRANCH.trim() : "";
  if (!branch || branch === "main") return PROD_WORKER_ORIGIN;

  // Workers Builds branch alias: <sanitized-branch>-<worker-name>.<subdomain>
  // e.g. cursor/lightbox-info-panel-94d0 → cursor-lightbox-info-panel-94d0-digital-archive...
  const sanitized = branch.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-");
  return `https://${sanitized}-${WORKER_NAME}.${WORKERS_SUBDOMAIN}`;
}

/**
 * Proxy /api/* from Pages (same origin) to the API Worker so session cookies
 * stay on *.pages.dev.
 */
export const onRequest: PagesFunction = async (context) => {
  const incoming = new URL(context.request.url);
  const origin = workerOrigin(context.env as Record<string, unknown>);
  const target = new URL(
    `${incoming.pathname}${incoming.search}`,
    origin,
  );

  const headers = new Headers(context.request.headers);
  headers.delete("host");
  // Tell the Worker this is a same-origin Pages proxy so cookies can be Lax.
  headers.set("X-Forwarded-Host", incoming.host);
  headers.set("X-Forwarded-Proto", incoming.protocol.replace(":", ""));

  try {
    const init: RequestInit = {
      method: context.request.method,
      headers,
      redirect: "manual",
    };

    if (context.request.method !== "GET" && context.request.method !== "HEAD") {
      // Buffer the body — streaming request bodies are unreliable in Pages Functions.
      init.body = await context.request.arrayBuffer();
    }

    const upstream = await fetch(target.toString(), init);
    const responseHeaders = new Headers(upstream.headers);

    // Rewrite Set-Cookie for the Pages host: drop Domain, prefer SameSite=Lax.
    const rawCookies =
      typeof upstream.headers.getSetCookie === "function"
        ? upstream.headers.getSetCookie()
        : [];
    if (rawCookies.length) {
      responseHeaders.delete("set-cookie");
      for (const cookie of rawCookies) {
        const rewritten = cookie
          .replace(/;\s*Domain=[^;]*/gi, "")
          .replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
        responseHeaders.append("set-cookie", rewritten);
      }
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "proxy_failed";
    return Response.json(
      { error: "proxy_failed", message, worker_origin: origin },
      { status: 502 },
    );
  }
};
