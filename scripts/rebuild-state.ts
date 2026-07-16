import { buildStateFromFiles, writeState } from "../src/lib/data-store.ts";
const state = await buildStateFromFiles();
await writeState(state);
console.log("Saved. Dealers:", state.dealers.length);
const b = state.dealers.find(d => d.name.toLowerCase().includes("богатов"));
console.log("Богатов:", b?.name, "→", JSON.stringify(b?.plan), "total:", b ? b.plan.service + b.plan.equipment + b.plan.materials : null);

// Check service scale values for verification
console.log("\n=== Service scale values for first РФ dealer ===");
const rfDealer = state.dealers.find(d => d.type === "РФ");
if (rfDealer) {
  const svcScale = rfDealer.scales?.find(s => s.title.toLowerCase().includes("сервис"));
  if (svcScale) {
    console.log("Title:", svcScale.title);
    console.log("Columns:", svcScale.columns);
    console.log("Values:", svcScale.rows[0]?.values);
  }
}

console.log("\n=== Service scale values for first Заруб dealer ===");
const zbDealer = state.dealers.find(d => d.type === "Заруб");
if (zbDealer) {
  const svcScale = zbDealer.scales?.find(s => s.title.toLowerCase().includes("сервис"));
  if (svcScale) {
    console.log("Title:", svcScale.title);
    console.log("Columns:", svcScale.columns);
    console.log("Values:", svcScale.rows[0]?.values);
  }
}
