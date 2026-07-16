/**
 * Test script: list files in the shared Drive folder using the SA key.
 * Run with: bun run scripts/test-drive-list.ts
 */
import { listDriveFiles, syncFromGoogleDrive } from "../src/lib/drive-sync";
import path from "path";

async function main() {
  console.log("=== Test 1: List files in Drive folder ===");
  try {
    const files = await listDriveFiles();
    console.log(`Found ${files.length} files:`);
    for (const f of files) {
      console.log(`  - ${f.name}  (${f.mimeType}, modified: ${f.modifiedTime})`);
    }
  } catch (err) {
    console.error("FAILED to list files:", err);
    process.exit(1);
  }

  console.log("\n=== Test 2: Sync Drive → local ===");
  const uploadsDir = path.resolve(process.cwd(), "data", "uploads");
  console.log("Target dir:", uploadsDir);
  const result = await syncFromGoogleDrive(uploadsDir);
  console.log("ok:", result.ok);
  console.log("pulled:", result.pulled);
  console.log("skipped:", result.skipped);
  if (result.error) console.log("error:", result.error);
}

main().catch((e) => {
  console.error("Unhandled:", e);
  process.exit(1);
});
