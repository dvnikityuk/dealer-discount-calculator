import { NextRequest, NextResponse } from "next/server";
import { readState, writeState } from "@/lib/data-store";
import type { DealerData } from "@/lib/types";

/**
 * POST /api/dealer
 * Body: { name, type, plan: { service, equipment, materials } }
 * Adds a new dealer with empty facts.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, type, plan } = body;
    if (!name || !type || !plan) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }
    const state = await readState();
    const id = String(name).toLowerCase().replace(/[^a-z0-9а-я]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 50) || `dealer-${Date.now()}`;
    const dealer: DealerData = {
      id,
      name,
      type,
      plan: {
        service: Number(plan.service) || 0,
        equipment: Number(plan.equipment) || 0,
        materials: Number(plan.materials) || 0,
      },
      facts: {
        service: { months: Array(12).fill(null) },
        equipment: { months: Array(12).fill(null) },
        materials: { months: Array(12).fill(null) },
      },
      servicePercent: type === "РФ" ? 14.0 : 10.0,
      scales: state.dealers.find((d) => d.type === type)?.scales,
    };
    await writeState({ ...state, dealers: [...state.dealers, dealer] });
    return NextResponse.json({ ok: true, dealer });
  } catch (err) {
    console.error("[/api/dealer POST]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

/**
 * PUT /api/dealer
 * Body: full dealer object
 * Updates an existing dealer by id.
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, type, plan, facts, servicePercent } = body;
    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }
    const state = await readState();
    const dealers = state.dealers.map((d) =>
      d.id === id
        ? {
            ...d,
            name: name ?? d.name,
            type: type ?? d.type,
            plan: plan ?? d.plan,
            facts: facts ?? d.facts,
            servicePercent: servicePercent ?? d.servicePercent,
          }
        : d,
    );
    await writeState({ ...state, dealers });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/dealer PUT]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

/**
 * DELETE /api/dealer?id=...
 * Removes a dealer by id.
 */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }
    const state = await readState();
    await writeState({ ...state, dealers: state.dealers.filter((d) => d.id !== id) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/dealer DELETE]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
