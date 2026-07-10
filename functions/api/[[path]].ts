const WORKER_ORIGIN = "https://digital-archive.rytecode.workers.dev";

/**
 * Proxy /api/* from Pages (same origin) to the API Worker so session cookies
 * stay on *.pages.dev.
 */
export const onRequest: PagesFunction = async (context) => {
  const incoming = new URL(context.request.url);
  const target = new URL(
    `${incoming.pathname}${incoming.search}`,
    WORKER_ORIGIN,
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
    return Response.json({ error: "proxy_failed", message }, { status: 502 });
  }
};
