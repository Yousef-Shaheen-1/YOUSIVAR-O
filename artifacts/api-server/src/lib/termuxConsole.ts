/**
 * The owner's Termux catalog.
 *
 * This module stores documentation — projects, commands, scripts and guides the
 * owner reviews — and states plainly what the deployment can do with it. The
 * application has no shell-execution endpoint: nothing in this file, or in the
 * routes that use it, can spawn a process, and `TERMUX_CAPABILITY` reports that
 * fact to the console instead of hiding it behind a disabled-looking button.
 *
 * Anything a user runs, they run themselves, on their own Android device, in
 * their own Termux session. That keeps the feature useful without turning a web
 * deployment into a remote shell.
 */

export const TERMUX_ENTRY_KINDS = ["project", "command", "script", "guide"] as const;
export type TermuxEntryKind = (typeof TERMUX_ENTRY_KINDS)[number];

export type TermuxEntry = {
  id: string;
  kind: TermuxEntryKind;
  title: string;
  titleAr: string | null;
  summary: string;
  command: string;
  documentationUrl: string | null;
  requiresRoot: boolean;
  requiresStorage: boolean;
  enabled: boolean;
  notes: string | null;
};

export type TermuxCatalog = {
  intro: string;
  introAr: string;
  entries: TermuxEntry[];
  updatedAt: string | null;
};

export const TERMUX_RECORD_KEY = "termux-catalog";
export const TERMUX_MAX_ENTRIES = 100;

export const DEFAULT_TERMUX_CATALOG: TermuxCatalog = {
  intro: "",
  introAr: "",
  entries: [],
  updatedAt: null,
};

/**
 * Reported to the console and rendered as a banner. No deployment of this
 * application exposes shell execution, so the value is constant rather than
 * configuration — a web endpoint that could run `command` would be a remote
 * shell for anyone who reached it.
 */
export const TERMUX_CAPABILITY = {
  executionAvailable: false,
  reason:
    "The web application never executes shell commands. A public endpoint that ran arbitrary commands would be a remote shell, so this console manages the catalog, previews each command and records your review instead of running anything.",
  localRunHint:
    "Run the command yourself in the Termux app on your Android device. The Android application does not open a terminal session either.",
  supportedKinds: [...TERMUX_ENTRY_KINDS],
} as const;

export function mergeTermuxCatalog(value: Partial<TermuxCatalog> | null | undefined): TermuxCatalog {
  if (!value) return DEFAULT_TERMUX_CATALOG;
  return {
    intro: typeof value.intro === "string" ? value.intro : "",
    introAr: typeof value.introAr === "string" ? value.introAr : "",
    entries: Array.isArray(value.entries) ? value.entries : [],
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

/**
 * Entries are documentation, so the checks are about the record being usable
 * on screen: an identifier that can be referenced, a command that is plain text
 * (no control characters, no invisible rewriting of what the owner sees), and a
 * link that cannot point at a `javascript:` URL.
 */
export function termuxCatalogError(catalog: TermuxCatalog): string | null {
  if (catalog.entries.length > TERMUX_MAX_ENTRIES) {
    return `At most ${TERMUX_MAX_ENTRIES} entries can be stored`;
  }
  const seen = new Set<string>();
  for (const entry of catalog.entries) {
    if (!/^[a-z0-9][a-z0-9._-]{0,59}$/i.test(entry.id)) {
      return `"${entry.id}" is not a usable entry identifier (letters, digits, dot, dash and underscore)`;
    }
    if (seen.has(entry.id.toLowerCase())) {
      return `The entry identifier "${entry.id}" is used twice`;
    }
    seen.add(entry.id.toLowerCase());
    if (!entry.title.trim()) {
      return `The entry "${entry.id}" needs a title`;
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(entry.command)) {
      return `The command for "${entry.id}" contains control characters that cannot be displayed or copied faithfully`;
    }
    if (entry.documentationUrl) {
      try {
        const parsed = new URL(entry.documentationUrl);
        if (parsed.protocol !== "https:") {
          return `The documentation link for "${entry.id}" must use https`;
        }
      } catch {
        return `The documentation link for "${entry.id}" is not a valid URL`;
      }
    }
  }
  return null;
}
