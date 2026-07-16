"use server";

import { readState, writeState, syncFromDisk } from "./data-store";
import type { AppState, DealerData, Quarter } from "./types";
import { revalidatePath } from "next/cache";

/** Sync from disk: re-reads state.json, invalidates page cache. Triggers fresh data on F5. */
export async function syncDiskAction(): Promise<{ ok: boolean; lastSync: string }> {
  await syncFromDisk();
  revalidatePath("/");
  return { ok: true, lastSync: new Date().toISOString() };
}

/** Changes the active quarter. */
export async function setQuarterAction(quarter: Quarter): Promise<void> {
  const state = await readState();
  await writeState({ ...state, quarter });
  revalidatePath("/");
}

/** Adds a new dealer with empty facts. */
export async function addDealerAction(input: {
  name: string;
  type: "РФ" | "Заруб";
  planService: number;
  planEquipment: number;
  planMaterials: number;
}): Promise<void> {
  const state = await readState();
  const id = input.name
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `dealer-${Date.now()}`;

  const dealer: DealerData = {
    id,
    name: input.name,
    type: input.type,
    plan: {
      service: input.planService,
      equipment: input.planEquipment,
      materials: input.planMaterials,
    },
    facts: {
      service: { months: Array(12).fill(null) },
      equipment: { months: Array(12).fill(null) },
      materials: { months: Array(12).fill(null) },
    },
    servicePercent: input.type === "РФ" ? 14.0 : 10.0,
  };
  await writeState({ ...state, dealers: [...state.dealers, dealer] });
  revalidatePath("/");
}

/** Updates a dealer's plan + monthly facts. */
export async function updateDealerAction(input: {
  id: string;
  name: string;
  type: "РФ" | "Заруб";
  plan: { service: number; equipment: number; materials: number };
  facts: {
    service: (number | null)[];
    equipment: (number | null)[];
    materials: (number | null)[];
  };
  servicePercent: number | null;
}): Promise<void> {
  const state = await readState();
  const dealers = state.dealers.map((d) =>
    d.id === input.id
      ? {
          ...d,
          name: input.name,
          type: input.type,
          plan: input.plan,
          facts: {
            service: { months: input.facts.service },
            equipment: { months: input.facts.equipment },
            materials: { months: input.facts.materials },
          },
          servicePercent: input.servicePercent,
        }
      : d,
  );
  await writeState({ ...state, dealers });
  revalidatePath("/");
}

/** Deletes a dealer. */
export async function deleteDealerAction(id: string): Promise<void> {
  const state = await readState();
  await writeState({ ...state, dealers: state.dealers.filter((d) => d.id !== id) });
  revalidatePath("/");
}

/** Updates the scales tables (raw). */
export async function updateScalesAction(scales: AppState["scales"]): Promise<void> {
  const state = await readState();
  await writeState({ ...state, scales });
  revalidatePath("/");
}
