export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith('/api')) {
    return next();
  }

  const apiOrigin = env.API_PROXY_ORIGIN ?? env.PUBLIC_API_ORIGIN ?? env.API_ORIGIN;
  if (!apiOrigin) {
    return new Response(
      JSON.stringify({ error: 'API_PROXY_ORIGIN is not configured for this Pages deployment.' }),
      {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    );
  }

  const upstream = new URL(url.pathname.replace(/^\/api/, '/api') || '/api', apiOrigin);
  if (url.search) {
    upstream.search = url.search;
  }

  const headers = new Headers(request.headers);
  const forwardedHost = request.headers.get('host') ?? url.host;
  headers.set('host', forwardedHost);
  headers.set('x-forwarded-host', forwardedHost);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  headers.set('origin', url.origin);
  headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '');

  const body = ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? undefined : request.body;
  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
  });

  const nextHeaders = new Headers(response.headers);
  nextHeaders.set('x-yousivar-proxied', 'true');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders,
  });
}
