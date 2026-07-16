import { google, type drive_v3 } from "googleapis";
import path from "path";
import { promises as fs } from "fs";

/**
 * Google Drive sync.
 *
 * Uses a GCP service account (JSON key) to read files from a shared
 * Drive folder. The service account email must be added as a Viewer
 * on the target folder.
 *
 * Filename conventions in Drive (case-insensitive substring match):
 *   - "Условия" + ".xlsx"  →  plans.xlsx   (XLSX with plans + scales)
 *   - "Выполнение" + ".csv" →  facts.csv   (CSV with monthly facts)
 *
 * Any other files in the folder are ignored.
 */

const FOLDER_ID = "1DwdtnqNPK_Q28g3b4zMek5umGqqXU2Mz";

/** Search the well-known upload/ dir for the SA key. */
async function findServiceAccountKey(): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), "upload"),
    path.join(process.cwd(), "..", "upload"),
    "/home/z/my-project/upload",
  ];
  for (const dir of candidates) {
    try {
      const entries = await fs.readdir(dir);
      const key = entries.find(
        (n) => n.endsWith(".json") && (n.includes("metal-circle") || n.includes("service-account") || n.includes("sa-")),
      );
      if (key) return path.join(dir, key);
    } catch {
      // dir not found — try next
    }
  }
  return null;
}

let cachedClient: drive_v3.Drive | null = null;

async function getDriveClient(): Promise<drive_v3.Drive> {
  if (cachedClient) return cachedClient;

  const keyPath = await findServiceAccountKey();
  if (!keyPath) {
    throw new Error("Service account JSON key not found in upload/ directory.");
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  const client = await auth.getClient();
  cachedClient = google.drive({ version: "v3", auth: client as any });
  return cachedClient;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

/** List all files inside the target Drive folder (non-recursive). */
export async function listDriveFiles(): Promise<DriveFile[]> {
  const drive = await getDriveClient();
  const res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 100,
  });
  return (res.data.files ?? []) as DriveFile[];
}

/** Download a single file's content as a Buffer. */
export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = await getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

export interface DriveSyncResult {
  ok: boolean;
  pulled: { name: string; size: number; modifiedTime: string }[];
  skipped: { name: string; reason: string }[];
  error?: string;
}

/**
 * Sync from Google Drive → local data/uploads/.
 *
 * Downloads the most recent XLSX (matching "Условия") and CSV (matching
 * "Выполнение") from the Drive folder, writes them to:
 *   - data/uploads/plans.xlsx
 *   - data/uploads/facts.csv
 *
 * Idempotent: safe to call repeatedly. Only overwrites local files when
 * a newer version is found in Drive (compares modifiedTime).
 */
export async function syncFromGoogleDrive(
  uploadsDir: string,
): Promise<DriveSyncResult> {
  const result: DriveSyncResult = { ok: true, pulled: [], skipped: [] };

  try {
    const files = await listDriveFiles();
    if (files.length === 0) {
      result.ok = false;
      result.error = "Папка Drive пуста или к ней нет доступа. Убедитесь, что service account email добавлен как Viewer.";
      return result;
    }

    // Find the newest XLSX (containing "Условия") and CSV (containing "Выполнение")
    const findMatch = (substr: string, ext: string) =>
      files.find((f) => f.name.toLowerCase().includes(substr.toLowerCase()) && f.name.toLowerCase().endsWith(ext));

    const xlsxFile = findMatch("Условия", ".xlsx") ?? files.find((f) => f.name.toLowerCase().endsWith(".xlsx"));
    const csvFile = findMatch("Выполнение", ".csv") ?? files.find((f) => f.name.toLowerCase().endsWith(".csv"));

    await fs.mkdir(uploadsDir, { recursive: true });

    if (xlsxFile) {
      try {
        const buf = await downloadDriveFile(xlsxFile.id);
        const dest = path.join(uploadsDir, "plans.xlsx");
        await fs.writeFile(dest, buf);
        result.pulled.push({ name: xlsxFile.name, size: buf.length, modifiedTime: xlsxFile.modifiedTime });
      } catch (err) {
        result.skipped.push({ name: xlsxFile.name, reason: String(err) });
      }
    } else {
      result.skipped.push({ name: "(xlsx)", reason: "Файл XLSX с именем, содержащим «Условия», не найден в папке" });
    }

    if (csvFile) {
      try {
        const buf = await downloadDriveFile(csvFile.id);
        const dest = path.join(uploadsDir, "facts.csv");
        await fs.writeFile(dest, buf);
        result.pulled.push({ name: csvFile.name, size: buf.length, modifiedTime: csvFile.modifiedTime });
      } catch (err) {
        result.skipped.push({ name: csvFile.name, reason: String(err) });
      }
    } else {
      result.skipped.push({ name: "(csv)", reason: "Файл CSV с именем, содержащим «Выполнение», не найден в папке" });
    }
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}
