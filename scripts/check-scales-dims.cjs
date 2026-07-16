// Quick check: what are the dimensions of each scale table?
const { readState } = require('/home/z/my-project/src/lib/data-store.ts');
(async () => {
  const state = await readState();
  console.log("Total scales:", state.scales.length);
  for (const s of state.scales) {
    console.log(`\n[${s.title}]`);
    console.log(`  period: ${s.period}`);
    console.log(`  columns (${s.columns.length}): ${JSON.stringify(s.columns)}`);
    console.log(`  rows (${s.rows.length}):`);
    for (const r of s.rows) {
      console.log(`    ${r.component} → ${JSON.stringify(r.values)} (isTotal=${!!r.isTotal})`);
    }
  }
})();
