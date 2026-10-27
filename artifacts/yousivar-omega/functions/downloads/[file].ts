/**
 * Pages Function for `/downloads/*` — the Android APK distribution endpoint.
 *
 * In development the Vite plugin in `vite.config.ts` sets the package content
 * type; production must behave the same way, or browsers and download managers
 * that only accept a real Android package type refuse the file. The static
 * handler alone would send the type it infers for an `.apk` file, so this
 * Function re-serves the asset with the explicit type.
 *
 * `_routes.json` limits this Function to `/downloads/*`, so every other request
 * on the site stays on the static path.
 */

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
};

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

export const onRequest = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const response = await context.env.ASSETS.fetch(context.request);
  const { pathname } = new URL(context.request.url);
  if (!pathname.toLowerCase().endsWith('.apk')) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('Content-Type', APK_CONTENT_TYPE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
