import { promises as fs } from "fs";
import path from "path";
import type { AppState, DealerData } from "./types";
import { parseFactsCsv } from "./parse-facts";
import { parsePlansXlsx, type ParsedXlsxDealer } from "./parse-plans";

const DATA_DIR = path.join(process.cwd(), "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const FACTS_FILE = path.join(UPLOADS_DIR, "facts.csv");
const PLANS_FILE = path.join(UPLOADS_DIR, "plans.xlsx");
const STATE_FILE = path.join(DATA_DIR, "state.json");

/**
 * Inbound dropbox: this is where the IM gateway / file-pasting pipeline puts
 * freshly uploaded files from the user. Anything that lands here is treated as
 * the canonical "newer" version and should be copied into data/uploads/ before
 * state is rebuilt.
 *
 * We recognise two well-known filename patterns:
 *   - "Выполнение*.csv"      → facts.csv
 *   - "Условия*.xlsx"        → plans.xlsx
 *
 * Direct user uploads via /api/upload save straight to data/uploads/ and skip
 * this scan.
 */
const INBOUND_DIR = path.join(process.cwd(), "upload");

/** Find the most recent file in `dir` matching one of the given extensions. */
async function findLatestByExt(dir: string, exts: string[]): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let best: { path: string; mtime: number } | null = null;
    for (const e of entries) {
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      if (!exts.some((x) => lower.endsWith(x))) continue;
      // Skip hidden/system files
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      try {
        const st = await fs.stat(full);
        if (!best || st.mtimeMs > best.mtime) best = { path: full, mtime: st.mtimeMs };
      } catch {
        // stat failed — skip
      }
    }
    return best?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * Pull newer files from the inbound dropbox (./upload/) into data/uploads/.
 * Compares mtimes: only copies if the inbound file is newer than the current
 * data/uploads/ copy (or if the latter doesn't exist yet).
 *
 * Returns true if at least one file was copied.
 */
async function pullFromInbound(): Promise<boolean> {
  let copied = false;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  // CSV facts: "Выполнение*.csv"
  const inboundCsv = await findLatestByExt(INBOUND_DIR, [".csv"]);
  if (inboundCsv) {
    let shouldCopy = true;
    try {
      const cur = await fs.stat(FACTS_FILE);
      const inc = await fs.stat(inboundCsv);
      // Only copy if inbound is strictly newer (>= 2s tolerance to avoid flapping)
      shouldCopy = inc.mtimeMs - cur.mtimeMs > 2000;
    } catch {
      // No existing file — copy
    }
    if (shouldCopy) {
      await fs.copyFile(inboundCsv, FACTS_FILE);
      console.log(`[data-store] Pulled new facts CSV from ${inboundCsv} → ${FACTS_FILE}`);
      copied = true;
    }
  }

  // XLSX plans: "Условия*.xlsx"
  const inboundXlsx = await findLatestByExt(INBOUND_DIR, [".xlsx"]);
  if (inboundXlsx) {
    let shouldCopy = true;
    try {
      const cur = await fs.stat(PLANS_FILE);
      const inc = await fs.stat(inboundXlsx);
      shouldCopy = inc.mtimeMs - cur.mtimeMs > 2000;
    } catch {
      // No existing file — copy
    }
    if (shouldCopy) {
      await fs.copyFile(inboundXlsx, PLANS_FILE);
      console.log(`[data-store] Pulled new plans XLSX from ${inboundXlsx} → ${PLANS_FILE}`);
      copied = true;
    }
  }

  return copied;
}

/** Build a DealerData object from a parsed XLSX dealer + matching CSV facts entry. */
function buildDealerData(
  parsed: ParsedXlsxDealer,
  facts: Map<string, { service: (number | null)[]; equipment: (number | null)[]; materials: (number | null)[] }>,
): DealerData {
  // Try to match by exact csvName (which equals displayName in most cases)
  let factEntry = facts.get(parsed.csvName);

  // Fuzzy fallback: if no exact match, try by sheet name (some CSV entries use just the short name)
  if (!factEntry) {
    const keys = Array.from(facts.keys());
    // Try matching by sheet name (with country suffix removed)
    const match = keys.find((k) => {
      const kNorm = k.toLowerCase().split(",")[0].trim();
      const sNorm = parsed.sheetName.toLowerCase().split(",")[0].trim();
      return kNorm === sNorm || kNorm.includes(sNorm) || sNorm.includes(kNorm);
    });
    if (match) factEntry = facts.get(match);
  }

  // Generate stable id from sheet name
  const id = parsed.sheetName
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || `dealer-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    name: parsed.displayName,
    type: parsed.type,
    plan: parsed.plan,
    facts: {
      service: { months: factEntry?.service ?? Array(12).fill(null) },
      equipment: { months: factEntry?.equipment ?? Array(12).fill(null) },
      materials: { months: factEntry?.materials ?? Array(12).fill(null) },
    },
    servicePercent: null, // computed at display time from scales; null means "use default"
    scales: parsed.scales,
  };
}

/**
 * Build the application state by parsing uploaded files.
 * This is the single source of truth: state.json is just a cache.
 */
export async function buildStateFromFiles(): Promise<AppState> {
  // Pull newer files from ./upload/ dropbox if any (idempotent — only copies
  // when inbound is strictly newer). This makes both F5 and the "Диск" button
  // pick up files pasted via the IM gateway.
  try {
    await pullFromInbound();
  } catch (err) {
    console.warn("[data-store] pullFromInbound failed (non-fatal):", err);
  }

  // Check if files exist
  let facts: Map<string, { service: (number | null)[]; equipment: (number | null)[]; materials: (number | null)[] }> = new Map();
  let dealers: ParsedXlsxDealer[] = [];

  try {
    facts = await parseFactsCsv(FACTS_FILE);
  } catch (err) {
    console.warn("[data-store] No facts.csv found or parse error:", err);
  }
  try {
    dealers = await parsePlansXlsx(PLANS_FILE);
  } catch (err) {
    console.warn("[data-store] No plans.xlsx found or parse error:", err);
  }

  // Check for user-saved overrides (e.g., added/edited dealers via UI)
  let userOverrides: AppState | null = null;
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    userOverrides = JSON.parse(raw) as AppState;
  } catch {
    // No state.json yet — first run
  }

  // Build fresh dealer list from parsed files
  const freshDealers = dealers.map((d) => buildDealerData(d, facts));

  // Merge user-added dealers that aren't in the file (by id)
  const fileIds = new Set(freshDealers.map((d) => d.id));
  const userExtraDealers = (userOverrides?.dealers ?? []).filter((d) => !fileIds.has(d.id));

  // Apply user-edited values for dealers that ARE in the file (preserve edits)
  const finalDealers = freshDealers.map((d) => {
    const override = userOverrides?.dealers.find((x) => x.id === d.id);
    if (!override) return d;
    // Prefer user-edited values where present
    return {
      ...d,
      name: override.name ?? d.name,
      type: override.type ?? d.type,
      plan: override.plan ?? d.plan,
      facts: override.facts ?? d.facts,
      servicePercent: override.servicePercent ?? d.servicePercent,
    };
  });

  // If no dealers at all (e.g., first run before any file uploaded), use overrides if available
  const allDealers = [...finalDealers, ...userExtraDealers];
  if (allDealers.length === 0 && userOverrides) {
    return userOverrides;
  }

  return {
    quarter: userOverrides?.quarter ?? 1,
    dealers: allDealers,
    scales: freshDealers[0]?.scales ?? userOverrides?.scales ?? [],
    lastSync: new Date().toISOString(),
  };
}

/**
 * Read the application state.
 *
 * IMPORTANT: Always re-reads from disk (parses the uploaded files) to ensure F5
 * picks up file changes. Never returns a stale in-memory cache.
 */
export async function readState(): Promise<AppState> {
  const state = await buildStateFromFiles();
  return state;
}

/**
 * Save user overrides (added/edited dealers, changed quarter) to state.json.
 * These are merged with file-derived data on next read.
 */
export async function writeState(state: AppState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");

  try {
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/");
  } catch {
    // Not in Next.js context (e.g., test script) — ignore
  }
}

/**
 * Save uploaded files to data/uploads/, then rebuild state.
 * @param factsCsv - raw CSV text (UTF-8 with BOM is OK)
 * @param plansXlsx - Buffer of XLSX file
 */
export async function saveUploadedFiles(factsCsv: string | null, plansXlsx: Buffer | null): Promise<AppState> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  if (factsCsv) {
    await fs.writeFile(FACTS_FILE, factsCsv, "utf-8");
  }
  if (plansXlsx) {
    await fs.writeFile(PLANS_FILE, plansXlsx);
  }

  const state = await buildStateFromFiles();
  await writeState(state);
  return state;
}

/**
 * Sync from disk: re-parse uploaded files and rebuild state.
 * This is what the "Диск" button invokes.
 */
export async function syncFromDisk(): Promise<AppState> {
  // Clear state.json to force fresh re-derivation (drops user overrides too — that's intentional)
  try {
    await fs.unlink(STATE_FILE);
  } catch {
    // File doesn't exist — OK
  }

  const state = await buildStateFromFiles();
  await writeState(state);

  try {
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/");
  } catch {
    // Not in Next.js context — ignore
  }

  return state;
}

export { DATA_DIR, UPLOADS_DIR, FACTS_FILE, PLANS_FILE, STATE_FILE };
