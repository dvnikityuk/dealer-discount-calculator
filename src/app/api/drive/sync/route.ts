import { NextResponse } from "next/server";
import path from "path";
import { syncFromDisk } from "@/lib/data-store";
import { syncFromGoogleDrive } from "@/lib/drive-sync";

/**
 * POST /api/drive/sync
 *
 * Pulls the newest XLSX (Условия) and CSV (Выполнение) from the shared
 * Google Drive folder into data/uploads/, then rebuilds state from those
 * files. Falls back to local-only sync if Drive is unreachable.
 */
export async function POST() {
  const uploadsDir = path.join(process.cwd(), "data", "uploads");

  // 1. Try Google Drive first.
  const driveResult = await syncFromGoogleDrive(uploadsDir);

  // 2. Then rebuild state from local files (which now include Drive-pulled copies).
  const state = await syncFromDisk();

  return NextResponse.json({
    ok: true,
    lastSync: state.lastSync,
    dealerCount: state.dealers.length,
    timestamp: new Date().toISOString(),
    drive: {
      ok: driveResult.ok,
      pulled: driveResult.pulled,
      skipped: driveResult.skipped,
      error: driveResult.error,
    },
  });
}

export async function GET() {
  return POST();
}
