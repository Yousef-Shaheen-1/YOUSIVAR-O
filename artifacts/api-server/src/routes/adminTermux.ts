import { Router, type IRouter } from "express";
import {
  ConfirmTermuxCommandBody,
  ConfirmTermuxCommandResponse,
  GetTermuxConsoleResponse,
  UpdateTermuxConsoleBody,
  UpdateTermuxConsoleResponse,
} from "@workspace/api-zod";
import { requireOwner } from "../middlewares/auth";
import { readSiteRecord, writeAudit, writeSiteRecord } from "../lib/yousivar";
import {
  DEFAULT_TERMUX_CATALOG,
  TERMUX_CAPABILITY,
  TERMUX_RECORD_KEY,
  mergeTermuxCatalog,
  termuxCatalogError,
  type TermuxCatalog,
} from "../lib/termuxConsole";

const router: IRouter = Router();

/**
 * Owner-only Termux console.
 *
 * `requireOwner` is the gate: it resolves the Ω owner session (or a Clerk
 * identity whose verified primary email is the configured owner) and rejects
 * everybody else with 401/403 before any handler runs. Hiding a button is not a
 * permission — every route here is protected on the server.
 *
 * There is no execution endpoint. `POST /admin/termux/confirm` records that the
 * owner reviewed a command and returns the command text to run locally; it
 * cannot start a process, because nothing in this application has a shell.
 */

function consolePayload(catalog: TermuxCatalog) {
  return {
    ...catalog,
    capability: {
      executionAvailable: TERMUX_CAPABILITY.executionAvailable,
      reason: TERMUX_CAPABILITY.reason,
      localRunHint: TERMUX_CAPABILITY.localRunHint,
      supportedKinds: [...TERMUX_CAPABILITY.supportedKinds],
    },
  };
}

async function readCatalog(): Promise<TermuxCatalog> {
  return mergeTermuxCatalog(
    await readSiteRecord<Partial<TermuxCatalog>>(TERMUX_RECORD_KEY, DEFAULT_TERMUX_CATALOG),
  );
}

router.get("/admin/termux", requireOwner, async (_req, res): Promise<void> => {
  res.json(GetTermuxConsoleResponse.parse(consolePayload(await readCatalog())));
});

router.put("/admin/termux", requireOwner, async (req, res): Promise<void> => {
  const parsed = UpdateTermuxConsoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const catalog: TermuxCatalog = {
    intro: parsed.data.intro,
    introAr: parsed.data.introAr,
    entries: parsed.data.entries,
    updatedAt: new Date().toISOString(),
  };
  const problem = termuxCatalogError(catalog);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  await writeSiteRecord(TERMUX_RECORD_KEY, catalog);
  await writeAudit(
    req.appIdentity!.userId,
    req.appIdentity!.email,
    "termux.catalog.update",
    `termux-catalog (${catalog.entries.length} entries)`,
  );
  res.json(UpdateTermuxConsoleResponse.parse(consolePayload(catalog)));
});

router.post("/admin/termux/confirm", requireOwner, async (req, res): Promise<void> => {
  const parsed = ConfirmTermuxCommandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!parsed.data.confirmation) {
    res.status(400).json({ error: "An explicit confirmation is required before a command is recorded for review" });
    return;
  }
  const catalog = await readCatalog();
  const entry = catalog.entries.find((candidate) => candidate.id === parsed.data.entryId);
  if (!entry) {
    res.status(404).json({ error: "That Termux entry is not in the catalog" });
    return;
  }

  await writeAudit(
    req.appIdentity!.userId,
    req.appIdentity!.email,
    "termux.command.review",
    `${entry.id} · ${entry.title}`,
  );

  res.json(
    ConfirmTermuxCommandResponse.parse({
      entryId: entry.id,
      recorded: true,
      executed: false,
      command: entry.command,
      message:
        "Review recorded. This server does not run the command: copy it and run it yourself in Termux on your Android device.",
    }),
  );
});

export default router;
