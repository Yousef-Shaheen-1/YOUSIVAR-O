import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  ConnectGithubTokenBody,
  ConnectGithubTokenResponse,
  DisconnectGithubResponse,
  GetGithubIntegrationResponse,
  ListGithubBranchesParams,
  ListGithubBranchesResponse,
  ListGithubRepositoriesResponse,
  PreviewGithubImportBody,
  PreviewGithubImportResponse,
  PublishGithubImportBody,
  PublishGithubImportResponse,
  StartGithubConnectResponse,
} from "@workspace/api-zod";
import { contentItems, db, type ContentAction } from "@workspace/db";
import { requireOwner } from "../middlewares/auth";
import { readSiteRecord, writeAudit, writeSiteRecord } from "../lib/yousivar";
import {
  GithubApiError,
  buildImportPreview,
  clearGithubConnection,
  exchangeGithubCode,
  githubAccessToken,
  githubOAuthConfigured,
  githubOAuthScopes,
  githubTokenStorageReady,
  listGithubBranches,
  listGithubRepositories,
  newImportId,
  parseRepository,
  readGithubConnection,
  readGithubImports,
  recordGithubImport,
  revokeGithubGrant,
  sealGithubToken,
  verifyGithubToken,
  writeGithubConnection,
  type GithubImportRecord,
  type StoredGithubConnection,
} from "../lib/githubIntegration";

const router: IRouter = Router();

const OAUTH_STATE_KEY = "github-oauth-state";
const CONSOLE_PATH = "/admin/github";

/**
 * Owner-only GitHub project integration.
 *
 * Every route is behind `requireOwner`, so only the authenticated owner reaches
 * it — the console hiding the button is a convenience, never the control. The
 * access token stays here: it is sealed with the server's key, never returned in
 * a response, never logged, and deleted by `DELETE /admin/github/connection`.
 *
 * Publishing is always an explicit, separate call. Previewing reads metadata,
 * the README and the file list; nothing reaches the catalog until the owner
 * sends the publish request, and even then it is saved as a draft unless
 * `publish: true` is set on purpose.
 */

type OauthState = { value: string; createdAt: string };

function githubErrorStatus(error: unknown): { status: number; message: string } {
  if (error instanceof GithubApiError) {
    if (error.status === 400) return { status: 400, message: error.message };
    if (error.status === 401) return { status: 400, message: `${error.message}. Reconnect the account.` };
    if (error.status === 404) return { status: 404, message: error.message };
    return { status: 502, message: error.message };
  }
  return { status: 500, message: "The GitHub request could not be completed" };
}

function sendGithubError(req: Request, res: Response, error: unknown): void {
  const { status, message } = githubErrorStatus(error);
  if (status >= 500) {
    req.log.error({ err: error }, "GitHub integration request failed");
  }
  res.status(status).json({ error: message });
}

async function requireConnectionToken(): Promise<string> {
  const token = await githubAccessToken();
  if (!token) {
    throw new GithubApiError(400, "No GitHub account is connected, or the stored token can no longer be read");
  }
  return token;
}

/**
 * Re-reads the catalog status of every tracked import, so the console shows what
 * is actually published rather than what was true when the import ran.
 */
async function withCurrentStatus(imports: GithubImportRecord[]): Promise<GithubImportRecord[]> {
  const ids = imports
    .map((entry) => entry.contentItemId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return imports;

  const rows = await db
    .select({ id: contentItems.id, status: contentItems.status })
    .from(contentItems)
    .where(inArray(contentItems.id, ids));
  const statuses = new Map(rows.map((row) => [row.id, row.status]));

  return imports.map((entry) => {
    if (!entry.contentItemId) return entry;
    const status = statuses.get(entry.contentItemId);
    if (!status) {
      return {
        ...entry,
        status: "failed" as const,
        deploymentStatus: "the catalog entry is gone",
        validation: {
          ok: false,
          issues: [...entry.validation.issues, "The catalog entry this import created no longer exists."],
        },
      };
    }
    return {
      ...entry,
      status: status as GithubImportRecord["status"],
      deploymentStatus:
        status === "published"
          ? "live in the public catalog"
          : status === "draft"
            ? "saved as a draft, not on the public catalog"
            : "archived",
    };
  });
}

async function integrationPayload() {
  const connection = await readGithubConnection();
  const imports = await withCurrentStatus(await readGithubImports());
  return {
    connection: {
      connected: Boolean(connection),
      method: connection?.method ?? ("none" as const),
      account: connection?.account ?? "",
      scopes: connection?.scopes ?? [],
      connectedAt: connection?.connectedAt ?? null,
      oauthConfigured: githubOAuthConfigured(),
      encryptionReady: githubTokenStorageReady(),
    },
    imports,
  };
}

router.get("/admin/github/status", requireOwner, async (_req, res): Promise<void> => {
  res.json(GetGithubIntegrationResponse.parse(await integrationPayload()));
});

router.post("/admin/github/connect/start", requireOwner, async (_req, res): Promise<void> => {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const scopes = githubOAuthScopes();
  if (!githubOAuthConfigured() || !clientId) {
    res.status(400).json({
      error:
        "GitHub OAuth is not configured on this deployment. Register an OAuth app and set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET, or connect with a scoped access token instead.",
    });
    return;
  }
  const state = randomBytes(24).toString("base64url");
  await writeSiteRecord<OauthState>(OAUTH_STATE_KEY, { value: state, createdAt: new Date().toISOString() });

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");

  res.json(
    StartGithubConnectResponse.parse({
      authorizeUrl: url.toString(),
      scopes,
      message: "Open the authorize URL to connect the account. The access token is stored on the server only.",
    }),
  );
});

router.get("/admin/github/callback", requireOwner, async (req, res): Promise<void> => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const stored = await readSiteRecord<OauthState | null>(OAUTH_STATE_KEY, null);
  const fail = (reason: string) => {
    res.redirect(302, `${CONSOLE_PATH}?github=error&reason=${encodeURIComponent(reason)}`);
  };

  if (!stored || !state || stored.value !== state) {
    fail("The authorization response did not match the request that started it. Start the connection again.");
    return;
  }
  const age = Date.now() - Date.parse(stored.createdAt);
  if (!Number.isFinite(age) || age > 15 * 60 * 1000) {
    fail("The authorization request expired. Start the connection again.");
    return;
  }
  if (!code) {
    fail("GitHub did not return an authorization code.");
    return;
  }

  try {
    const { token, scopes } = await exchangeGithubCode(code);
    const account = await verifyGithubToken(token);
    const connection: StoredGithubConnection = {
      method: "oauth",
      account: account.login,
      accountName: account.name,
      scopes: scopes.length > 0 ? scopes : account.scopes,
      tokenCipher: sealGithubToken(token),
      connectedAt: new Date().toISOString(),
    };
    await writeGithubConnection(connection);
    await writeSiteRecord<OauthState | null>(OAUTH_STATE_KEY, null);
    await writeAudit(req.appIdentity!.userId, req.appIdentity!.email, "github.connect", account.login);
    res.redirect(302, `${CONSOLE_PATH}?github=connected`);
  } catch (error) {
    const { message } = githubErrorStatus(error);
    fail(message);
  }
});

router.post("/admin/github/connect/token", requireOwner, async (req, res): Promise<void> => {
  const parsed = ConnectGithubTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!githubTokenStorageReady()) {
    res.status(400).json({
      error:
        "GITHUB_TOKEN_ENCRYPTION_KEY is not configured, so an access token cannot be stored safely. Set it and connect again.",
    });
    return;
  }
  try {
    const token = parsed.data.token.trim();
    const account = await verifyGithubToken(token);
    await writeGithubConnection({
      method: "token",
      account: account.login,
      accountName: account.name,
      scopes: account.scopes,
      tokenCipher: sealGithubToken(token),
      connectedAt: new Date().toISOString(),
    });
    await writeAudit(req.appIdentity!.userId, req.appIdentity!.email, "github.connect", account.login);
    res.json(ConnectGithubTokenResponse.parse(await integrationPayload()));
  } catch (error) {
    sendGithubError(req, res, error);
  }
});

router.get("/admin/github/repositories", requireOwner, async (req, res): Promise<void> => {
  try {
    const token = await requireConnectionToken();
    res.json(ListGithubRepositoriesResponse.parse(await listGithubRepositories(token)));
  } catch (error) {
    sendGithubError(req, res, error);
  }
});

router.get(
  "/admin/github/repositories/:owner/:name/branches",
  requireOwner,
  async (req, res): Promise<void> => {
    const parsed = ListGithubBranchesParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "The repository path is not usable" });
      return;
    }
    if (!parseRepository(`${parsed.data.owner}/${parsed.data.name}`)) {
      res.status(400).json({ error: "The repository path is not usable" });
      return;
    }
    try {
      const token = await requireConnectionToken();
      res.json(
        ListGithubBranchesResponse.parse({
          branches: await listGithubBranches(token, parsed.data.owner, parsed.data.name),
        }),
      );
    } catch (error) {
      sendGithubError(req, res, error);
    }
  },
);

router.post("/admin/github/preview", requireOwner, async (req, res): Promise<void> => {
  const parsed = PreviewGithubImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const token = await requireConnectionToken();
    const preview = await buildImportPreview(token, parsed.data.repository, parsed.data.branch);
    await writeAudit(
      req.appIdentity!.userId,
      req.appIdentity!.email,
      "github.preview",
      `${preview.repository}@${preview.branch}`,
    );
    res.json(PreviewGithubImportResponse.parse(preview));
  } catch (error) {
    sendGithubError(req, res, error);
  }
});

router.post("/admin/github/publish", requireOwner, async (req, res): Promise<void> => {
  const parsed = PublishGithubImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const token = await requireConnectionToken();
    const preview = await buildImportPreview(token, parsed.data.repository, parsed.data.branch);

    const issues: string[] = [];
    if (!parsed.data.description.trim()) {
      issues.push("The catalog entry has no description yet.");
    }
    if (preview.readme === "") {
      issues.push("No README was found on the selected branch, so nothing was added to the entry's detail.");
    }
    if (parsed.data.publish && preview.warnings.some((warning) => warning.startsWith("This is a private"))) {
      issues.push("This repository is private; publishing makes its metadata visible in the public catalog.");
    }

    const tags = Array.from(
      new Set([...(preview.language ? [preview.language] : []), ...preview.topics, ...parsed.data.tags].filter(Boolean)),
    ).slice(0, 30);
    const actions: ContentAction[] = [
      { label: "View repository", url: `https://github.com/${preview.repository}`, kind: "primary" },
    ];
    if (preview.readmeUrl) {
      actions.push({ label: "Read the README", url: preview.readmeUrl, kind: "secondary" });
    }
    const metadata: Record<string, unknown> = {
      language: preview.language,
      stars: preview.stars,
      forks: preview.forks,
      githubFullName: preview.repository,
      githubBranch: preview.branch,
      importedAt: new Date().toISOString(),
    };
    const status = parsed.data.publish ? "published" : "draft";

    const values = {
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      url: `https://github.com/${preview.repository}`,
      tags,
      actions,
      metadata,
      status,
    };

    const existingId = preview.existingContentItemId;
    const [item] = existingId
      ? await db.update(contentItems).set(values).where(eq(contentItems.id, existingId)).returning()
      : await db
          .insert(contentItems)
          .values({ ...values, titleAr: null, descriptionAr: null, media: [] })
          .returning();

    if (!item) {
      res.status(500).json({ error: "The catalog entry could not be saved" });
      return;
    }

    const previous = (await readGithubImports()).find(
      (entry) => entry.repository === preview.repository && entry.branch === preview.branch,
    );
    const record: GithubImportRecord = {
      id: previous?.id ?? newImportId(),
      repository: preview.repository,
      branch: preview.branch,
      status: item.status as GithubImportRecord["status"],
      deploymentStatus:
        item.status === "published"
          ? "live in the public catalog"
          : "saved as a draft, not on the public catalog",
      contentItemId: item.id,
      validation: { ok: issues.length === 0, issues },
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await recordGithubImport(record);
    await writeAudit(
      req.appIdentity!.userId,
      req.appIdentity!.email,
      status === "published" ? "github.publish" : "github.import.draft",
      `${preview.repository}@${preview.branch}`,
    );

    res.status(201).json(PublishGithubImportResponse.parse({ item, record }));
  } catch (error) {
    sendGithubError(req, res, error);
  }
});

router.delete("/admin/github/connection", requireOwner, async (req, res): Promise<void> => {
  const connection = await readGithubConnection();
  let revoked = false;
  if (connection) {
    const token = await githubAccessToken();
    if (token && connection.method === "oauth") {
      revoked = await revokeGithubGrant(token).catch(() => false);
    }
  }
  await clearGithubConnection();
  await writeAudit(
    req.appIdentity!.userId,
    req.appIdentity!.email,
    "github.disconnect",
    revoked ? "token deleted and OAuth grant revoked" : "token deleted",
  );
  res.json(DisconnectGithubResponse.parse(await integrationPayload()));
});

export default router;
