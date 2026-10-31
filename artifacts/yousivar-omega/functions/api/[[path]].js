export async function onRequest({ request, env }) {
  if (!env.API) {
    return new Response("API service binding is missing", {
      status: 503
    });
  }

  return env.API.fetch(request);
}
