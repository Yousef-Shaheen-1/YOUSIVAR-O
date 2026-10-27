import { and, eq } from "drizzle-orm";
import { contentItems, db } from "@workspace/db";
import { readSiteRecord, writeSiteRecord } from "./yousivar";
import { openSecret, sealSecret, secretBoxReady } from "./secretBox";

/**
 * Owner-only GitHub project integration.
 *
 * The owner connects a GitHub account (OAuth app when one is registered, or a
 * scoped personal access token), browses what that connection can read, previews
 * an import, and only then publishes it into the existing catalog. The access
 * token is sealed with `secretBox` and never leaves the server: no endpoint of
 * this module returns it, logs it, or puts it in a response, and the browser
 * only ever learns the account login.
 *
 * Two things this module deliberately does not do:
 *   • it never reads files that look like credentials, and reports them as
 *     skipped rather than silently ignoring them;
 *   • it never executes anything from a repository — no workflows, no scripts,
 *     no hooks. A repository is data to be described, not code to be trusted.
 */

const GITHUB_API = "https://api.github.com";
export const GITHUB_CONNECTION_KEY = "github-integration";
export const GITHUB_IMPORTS_KEY = "github-imports";
const IMPORT_HISTORY_LIMIT = 50;
const README_CHARACTER_LIMIT = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;

export type GithubConnectionMethod = "oauth" | "token" | "none";

export type StoredGithubConnection = {
  method: Exclude<GithubConnectionMethod, "none">;
  account: string;
  accountName: string;
  scopes: string[];
  tokenCipher: string;
  connectedAt: string;
};

export type GithubImportRecordStatus = "draft" | "published" | "archived" | "failed";

export type GithubImportRecord = {
  id: string;
  repository: string;
  branch: string;
  status: GithubImportRecordStatus;
  deploymentStatus: string;
  contentItemId: string | null;
  validation: { ok: boolean; issues: string[] };
  createdAt: string;
  updatedAt: string;
};

export type GithubRepositorySummary = {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  updatedAt: string | null;
  htmlUrl: string;
  access: "admin" | "push" | "pull" | "none";
};

export type GithubImportAsset = { path: string; type: string; size: number };

export type GithubImportPreview = {
  repository: string;
  branch: string;
  title: string;
  description: string;
  readme: string;
  readmeUrl: string | null;
  topics: string[];
  language: string | null;
  stars: number;
  forks: number;
  assets: GithubImportAsset[];
  skippedSensitive: string[];
  warnings: string[];
  existingContentItemId: string | null;
};

export class GithubApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
  }
}

/**
 * Paths that carry credentials or private keys. They are never requested; the
 * directory listing only tells us they exist, and that name is reported to the
 * owner as skipped so nothing sensitive is imported by accident.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /^\.env/i,
  /\.env$/i,
  /\.(pem|key|p12|pfx|keystore|jks|asc|gpg)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /^\.(npmrc|pypirc|netrc|htpasswd)$/i,
  /(secret|credential|password)/i,
  /^\.aws$/i,
  /^\.ssh$/i,
  /^\.gnupg$/i,
];

function repoPath(path: string): string {
  return path.replace(/^\/+/, "");
}

function isSafeGithubPath(...segments: string[]): boolean {
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment.length <= 200 &&
      /^[A-Za-z0-9._-]+$/.test(segment) &&
      segment !== "." &&
      segment !== "..",
  );
}

/** `<owner>/<name>` split into two safe path segments, or null when unusable. */
export function parseRepository(repository: string): { owner: string; name: string } | null {
  const parts = repository.trim().replace(/^https?:\/\/github\.com\//i, "").split("/");
  if (parts.length !== 2) return null;
  const [owner, name] = parts.map((part) => part.trim());
  if (!owner || !name) return null;
  if (!isSafeGithubPath(owner, name)) return null;
  return { owner, name };
}

export function repositoryFullName(repository: string): string | null {
  const parsed = parseRepository(repository);
  return parsed ? `${parsed.owner}/${parsed.name}` : null;
}

export function githubOAuthConfigured(): boolean {
  return Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
}

/**
 * The minimum scope that still lets the owner import the repositories they
 * choose: their own account identity plus public repositories. A private
 * repository needs a broader scope, which the owner sets deliberately through
 * `GITHUB_OAUTH_SCOPES` (or by choosing the scopes of their own token) instead
 * of being requested up front.
 */
export function githubOAuthScopes(): string[] {
  const configured = process.env.GITHUB_OAUTH_SCOPES?.trim();
  if (configured) {
    return configured.split(/[\s,]+/).filter((scope) => scope.length > 0);
  }
  return ["read:user", "public_repo"];
}

async function githubFetch<T>(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "yousivar-omega",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const message =
      response.status === 401
        ? "GitHub rejected the access token"
        : response.status === 403 || response.status === 429
          ? "GitHub rate limit reached, or the token is not allowed to read this repository"
          : response.status === 404
            ? "GitHub could not find that repository, branch or file for this connection"
            : `GitHub answered ${response.status}`;
    throw new GithubApiError(response.status, message);
  }
  return (await response.json()) as T;
}

function githubRequestHeaders(token: string | null): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "yousivar-omega",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export async function readGithubConnection(): Promise<StoredGithubConnection | null> {
  const stored = await readSiteRecord<StoredGithubConnection | null>(GITHUB_CONNECTION_KEY, null);
  if (!stored || typeof stored !== "object" || !stored.tokenCipher) return null;
  return stored;
}

export async function writeGithubConnection(
  connection: StoredGithubConnection,
): Promise<StoredGithubConnection> {
  return writeSiteRecord(GITHUB_CONNECTION_KEY, connection);
}

export async function clearGithubConnection(): Promise<void> {
  await writeSiteRecord<StoredGithubConnection | null>(GITHUB_CONNECTION_KEY, null);
}

/** The decrypted token, or null when nothing is connected or it cannot be opened. */
export async function githubAccessToken(): Promise<string | null> {
  const connection = await readGithubConnection();
  if (!connection) return null;
  return openSecret(connection.tokenCipher);
}

export function githubTokenStorageReady(): boolean {
  return secretBoxReady();
}

export function sealGithubToken(token: string): string {
  return sealSecret(token);
}

function parseScopes(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

/**
 * Confirms a token with GitHub and learns whose it is and what it may do. The
 * scope header is GitHub's own answer for a classic token; a fine-grained token
 * reports none, and that is shown as "not reported" rather than invented.
 */
export async function verifyGithubToken(token: string): Promise<{ login: string; name: string; scopes: string[] }> {
  const response = await fetch(`${GITHUB_API}/user`, {
    headers: githubRequestHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new GithubApiError(
      response.status,
      response.status === 401
        ? "GitHub rejected that access token"
        : `GitHub answered ${response.status} while checking the token`,
    );
  }
  const user = (await response.json()) as { login: string; name: string | null };
  return {
    login: user.login,
    name: user.name ?? user.login,
    scopes: parseScopes(response.headers.get("x-oauth-scopes")),
  };
}

export async function exchangeGithubCode(code: string): Promise<{ token: string; scopes: string[] }> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GithubApiError(400, "GitHub OAuth is not configured on this deployment");
  }
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; scope?: string; error_description?: string; error?: string }
    | null;
  if (!response.ok || !payload?.access_token) {
    throw new GithubApiError(
      400,
      payload?.error_description ?? payload?.error ?? "GitHub refused the authorization code",
    );
  }
  return { token: payload.access_token, scopes: parseScopes(payload.scope ?? null) };
}

/** Asks GitHub to revoke the OAuth grant that produced the stored token. */
export async function revokeGithubGrant(token: string): Promise<boolean> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;
  const response = await fetch(`https://api.github.com/applications/${clientId}/grant`, {
    method: "DELETE",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/json",
      "user-agent": "yousivar-omega",
    },
    body: JSON.stringify({ access_token: token }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return response.status === 204;
}

function accessFromPermissions(permissions: Record<string, boolean> | undefined): GithubRepositorySummary["access"] {
  if (!permissions) return "none";
  if (permissions.admin) return "admin";
  if (permissions.push) return "push";
  if (permissions.pull) return "pull";
  return "none";
}

type GithubApiRepository = {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string } | null;
  private: boolean;
  default_branch: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string | null;
  html_url: string;
  permissions?: Record<string, boolean>;
};

function toRepositorySummary(repository: GithubApiRepository): GithubRepositorySummary {
  return {
    id: repository.id,
    fullName: repository.full_name,
    name: repository.name,
    owner: repository.owner?.login ?? repository.full_name.split("/")[0] ?? "",
    private: repository.private,
    defaultBranch: repository.default_branch,
    description: repository.description,
    language: repository.language,
    stars: repository.stargazers_count,
    forks: repository.forks_count,
    updatedAt: repository.updated_at,
    htmlUrl: repository.html_url,
    access: accessFromPermissions(repository.permissions),
  };
}

export async function listGithubRepositories(token: string): Promise<GithubRepositorySummary[]> {
  const repositories = await githubFetch<GithubApiRepository[]>(
    "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    token,
  );
  return repositories.map(toRepositorySummary);
}

export async function listGithubBranches(
  token: string,
  owner: string,
  name: string,
): Promise<string[]> {
  const branches = await githubFetch<Array<{ name: string }>>(
    `/repos/${repoPath(owner)}/${repoPath(name)}/branches?per_page=100`,
    token,
  );
  return branches.map((branch) => branch.name);
}

function decodeReadme(payload: { content?: string; encoding?: string } | null): string {
  if (!payload?.content) return "";
  try {
    const decoded =
      payload.encoding === "base64"
        ? Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8")
        : payload.content;
    return decoded;
  } catch {
    return "";
  }
}

/**
 * Removes the two constructs that would matter if the README were ever rendered
 * as markup rather than text. The console shows the README as plain text, so
 * this is defence in depth, and the owner is told when something was removed.
 */
function stripActiveMarkup(markdown: string): { text: string; removed: boolean } {
  const withoutScripts = markdown.replace(/<script[\s\S]*?<\/script>/gi, "");
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, "");
  const withoutInlineHandlers = withoutStyles.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return {
    text: withoutInlineHandlers,
    removed: withoutInlineHandlers.length !== markdown.length,
  };
}

type GithubContentEntry = { name: string; path: string; type: string; size: number };

async function listTopLevelContents(
  token: string,
  owner: string,
  name: string,
  branch: string,
): Promise<GithubContentEntry[]> {
  const contents = await githubFetch<GithubContentEntry[] | GithubContentEntry>(
    `/repos/${repoPath(owner)}/${repoPath(name)}/contents?ref=${encodeURIComponent(branch)}`,
    token,
  );
  return Array.isArray(contents) ? contents : [contents];
}

/**
 * Reads everything the previous import recorded for the same repository so the
 * preview can say "this updates an existing catalog entry" before anything is
 * written.
 */
async function findExistingContentItemId(fullName: string): Promise<string | null> {
  const [existing] = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(and(eq(contentItems.category, "repositories"), eq(contentItems.title, fullName)))
    .limit(1);
  return existing?.id ?? null;
}

export async function buildImportPreview(
  token: string,
  repository: string,
  branch: string,
): Promise<GithubImportPreview> {
  const parsed = parseRepository(repository);
  if (!parsed) {
    throw new GithubApiError(400, "The repository must be written as owner/name");
  }
  if (!isSafeGithubPath(branch)) {
    throw new GithubApiError(400, "The branch name contains characters this API will not request");
  }

  const meta = await githubFetch<GithubApiRepository>(
    `/repos/${repoPath(parsed.owner)}/${repoPath(parsed.name)}`,
    token,
  );
  const topics = await githubFetch<{ names?: string[] }>(
    `/repos/${repoPath(parsed.owner)}/${repoPath(parsed.name)}/topics`,
    token,
  ).catch(() => ({ names: [] as string[] }));

  let readme = "";
  let readmeUrl: string | null = null;
  const warnings: string[] = [];
  try {
    const readmePayload = await githubFetch<{ content?: string; encoding?: string; html_url?: string }>(
      `/repos/${repoPath(parsed.owner)}/${repoPath(parsed.name)}/readme?ref=${encodeURIComponent(branch)}`,
      token,
    );
    readmeUrl = readmePayload.html_url ?? null;
    const stripped = stripActiveMarkup(decodeReadme(readmePayload));
    if (stripped.removed) {
      warnings.push("Script and style markup was removed from the README before preview.");
    }
    readme =
      stripped.text.length > README_CHARACTER_LIMIT
        ? `${stripped.text.slice(0, README_CHARACTER_LIMIT)}\n\n… (truncated for preview)`
        : stripped.text;
    if (stripped.text.length > README_CHARACTER_LIMIT) {
      warnings.push(`The README is longer than ${README_CHARACTER_LIMIT} characters and was truncated for the preview.`);
    }
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 404) {
      warnings.push("This repository has no README on the selected branch.");
    } else {
      throw error;
    }
  }

  const entries = await listTopLevelContents(token, parsed.owner, parsed.name, branch);
  const assets: GithubImportAsset[] = [];
  const skippedSensitive: string[] = [];
  for (const entry of entries) {
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(entry.name))) {
      skippedSensitive.push(entry.path);
      continue;
    }
    assets.push({
      path: entry.path,
      type: entry.type,
      size: typeof entry.size === "number" ? entry.size : 0,
    });
  }
  if (entries.some((entry) => entry.name === ".github")) {
    warnings.push("The repository contains a .github directory. Its workflows are never executed by this integration.");
  }
  if (meta.private) {
    warnings.push("This is a private repository: only the metadata shown here is imported, never its files.");
  }
  warnings.push("Only the top-level file list is read. Repository file contents are not copied into the catalog.");

  const fullName = `${parsed.owner}/${parsed.name}`;
  return {
    repository: fullName,
    branch,
    title: fullName,
    description: meta.description ?? "",
    readme,
    readmeUrl,
    topics: (topics.names ?? []).slice(0, 20),
    language: meta.language,
    stars: meta.stargazers_count,
    forks: meta.forks_count,
    assets: assets.slice(0, 100),
    skippedSensitive: skippedSensitive.slice(0, 50),
    warnings,
    existingContentItemId: await findExistingContentItemId(fullName),
  };
}

export async function readGithubImports(): Promise<GithubImportRecord[]> {
  const stored = await readSiteRecord<GithubImportRecord[]>(GITHUB_IMPORTS_KEY, []);
  return Array.isArray(stored) ? stored : [];
}

function importKey(repository: string, branch: string): string {
  return `${repository.toLowerCase()}@${branch}`;
}

export async function recordGithubImport(record: GithubImportRecord): Promise<GithubImportRecord> {
  const imports = await readGithubImports();
  const key = importKey(record.repository, record.branch);
  const next = [record, ...imports.filter((entry) => importKey(entry.repository, entry.branch) !== key)].slice(
    0,
    IMPORT_HISTORY_LIMIT,
  );
  await writeSiteRecord(GITHUB_IMPORTS_KEY, next);
  return record;
}

export function newImportId(): string {
  return `gh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
