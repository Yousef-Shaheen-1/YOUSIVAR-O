import { Router, type IRouter, type Request, type Response } from "express";
import {
  OwnerAuthError,
  currentOwnerSession,
  ownerAccessReadiness,
  ownerClientKey,
  requestOwnerVerificationCode,
  revokeOwnerSession,
  setOwnerSessionCookie,
  startOwnerChallenge,
  verifyOwnerCode,
} from "../lib/ownerAuth";

/**
 * Owner access endpoints backing the Ω flow.
 *
 * Every decision is made here on the server: the submitted email is only ever
 * compared against the authorized owner email, credentials are only ever
 * compared against the registered owner account, and the one-time code is
 * generated, hashed, delivered and verified server-side. Nothing in the
 * browser is treated as proof of identity.
 */
const router: IRouter = Router();

function field(value: unknown, max = 320): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function fail(error: unknown, req: Request, res: Response): void {
  if (error instanceof OwnerAuthError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  req.log.error({ err: error }, "Owner authentication request failed");
  res.status(503).json({ error: "Owner access is temporarily unavailable. Try again shortly." });
}

router.get("/owner/readiness", (_req, res): void => {
  res.json(ownerAccessReadiness());
});

router.post("/owner/session/start", async (req, res): Promise<void> => {
  try {
    const result = await startOwnerChallenge(field(req.body?.email), ownerClientKey(req));
    res.json({ authorized: true, ...result });
  } catch (error) {
    fail(error, req, res);
  }
});

router.post("/owner/session/code", async (req, res): Promise<void> => {
  try {
    const result = await requestOwnerVerificationCode(
      field(req.body?.challengeId, 64),
      field(req.body?.username, 200),
      typeof req.body?.password === "string" ? req.body.password.slice(0, 512) : "",
      ownerClientKey(req),
    );
    res.json({ sent: true, ...result });
  } catch (error) {
    fail(error, req, res);
  }
});

router.post("/owner/session/verify", async (req, res): Promise<void> => {
  try {
    const result = await verifyOwnerCode(
      field(req.body?.challengeId, 64),
      field(req.body?.code, 16),
      ownerClientKey(req),
      req.get("user-agent") ?? "",
    );
    setOwnerSessionCookie(res, result.token);
    res.json({
      authenticated: true,
      owner: { username: result.username, email: result.email },
      expiresAt: result.expiresAt,
      redirectTo: "/admin",
    });
  } catch (error) {
    fail(error, req, res);
  }
});

router.get("/owner/session", async (req, res): Promise<void> => {
  try {
    const owner = await currentOwnerSession(req);
    res.json(owner ? { authenticated: true, owner } : { authenticated: false });
  } catch (error) {
    fail(error, req, res);
  }
});

router.post("/owner/session/logout", async (req, res): Promise<void> => {
  try {
    const revoked = await revokeOwnerSession(req, res);
    res.json({ revoked });
  } catch (error) {
    fail(error, req, res);
  }
});

export default router;
