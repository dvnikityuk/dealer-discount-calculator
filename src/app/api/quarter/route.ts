import { NextRequest, NextResponse } from "next/server";
import { readState, writeState } from "@/lib/data-store";
import type { Quarter } from "@/lib/types";

/**
 * POST /api/quarter
 * Body: { quarter: 1|2|3|4 }
 * Changes the active quarter.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const q = Number(body.quarter);
    if (![1, 2, 3, 4].includes(q)) {
      return NextResponse.json({ ok: false, error: "Invalid quarter" }, { status: 400 });
    }
    const state = await readState();
    await writeState({ ...state, quarter: q as Quarter });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/quarter]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
