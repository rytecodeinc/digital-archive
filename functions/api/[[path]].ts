const WORKER_ORIGIN = "https://digital-archive.rytecode.workers.dev";

/**
 * Proxy /api/* from Pages (same origin) to the API Worker so session cookies
 * stay on *.pages.dev when Functions are enabled.
 *
 * Prefer VITE_API_BASE_URL / production default pointing at the Worker when
 * Pages Functions are not active for this project.
 */
export const onRequest: PagesFunction = async (context) => {
  const incoming = new URL(context.request.url);
  const target = new URL(
    `${incoming.pathname}${incoming.search}`,
    WORKER_ORIGIN,
  );

  const headers = new Headers(context.request.headers);
  headers.delete("host");

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
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: new Headers(upstream.headers),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "proxy_failed";
    return Response.json({ error: "proxy_failed", message }, { status: 502 });
  }
};
