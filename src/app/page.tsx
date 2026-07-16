import { readState } from "@/lib/data-store";
import { DealerApp } from "@/components/dealer-app";

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL FIX for the F5 / refresh problem.
//
// `force-dynamic` tells Next.js to render this page on EVERY request instead of
// caching the rendered HTML. Combined with `revalidatePath("/")` calls inside
// the server actions (after every write) and inside `/api/drive/sync`, the
// page will always re-read state.json from disk — whether the user hits F5,
// clicks "Диск", or just navigates back.
//
// Without these two lines, Next.js App Router caches the full page (Full Route
// Cache) and serves the stale RSC payload on F5 — exactly the bug the user
// reported.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function Page() {
  // Re-reads data/state.json from disk on every request.
  // readState() never touches the Next.js Data Cache.
  const state = await readState();

  return <DealerApp initialState={state} />;
}
