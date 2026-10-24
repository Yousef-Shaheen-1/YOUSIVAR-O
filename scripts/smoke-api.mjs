import assert from "node:assert/strict";

const configuredBase = process.env.API_BASE_URL ?? "http://127.0.0.1:5000";
const apiBase = new URL(configuredBase);
apiBase.pathname = `${apiBase.pathname.replace(/\/$/, "")}/api`;

async function get(path) {
  const response = await fetch(new URL(path, apiBase));
  return { response, body: await response.json().catch(() => null) };
}

const health = await get("/healthz");
assert.equal(health.response.status, 200, "health endpoint should respond successfully");

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
