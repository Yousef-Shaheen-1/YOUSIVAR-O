import assert from "node:assert/strict";

const configuredBase = process.env.API_BASE_URL ?? "http://127.0.0.1:5000";
const apiBase = new URL(configuredBase);
// The API is mounted under /api, so that prefix has to survive URL joining: a
// path with a leading slash replaces the whole base path, which used to send
// every request to the web server's HTML fallback instead of the API.
apiBase.pathname = `${apiBase.pathname.replace(/\/$/, "")}/api/`;

async function get(path) {
  const response = await fetch(new URL(path.replace(/^\//, ""), apiBase));
  return { response, body: await response.json().catch(() => null) };
}

const health = await get("/healthz");
assert.equal(health.response.status, 200, "health endpoint should respond successfully");
// Guards against the request landing on the site's HTML fallback, which also
// answers 200 and would make every check below meaningless.
assert.equal(health.body?.status, "ok", "health endpoint should return the API's status payload");

const site = await get("/site");
assert.equal(site.response.status, 200, "public site endpoint should be available");
assert.equal(typeof site.body?.settings?.projectName, "string");

const content = await get("/content");
assert.equal(content.response.status, 200, "public content endpoint should be available");
assert.ok(Array.isArray(content.body), "public content should be an array");
assert.ok(
  content.body.every((item) => item.status === "published"),
  "public content must not include drafts or archived entries",
);

const identity = await get("/admin/me");
assert.ok(
  [401, 403].includes(identity.response.status),
  `anonymous admin identity request must be denied (received ${identity.response.status})`,
);

const settings = await get("/admin/settings");
assert.ok(
  [401, 403].includes(settings.response.status),
  `anonymous settings request must be denied (received ${settings.response.status})`,
);

console.log("API smoke checks passed: public routes respond and anonymous admin access is denied.");
