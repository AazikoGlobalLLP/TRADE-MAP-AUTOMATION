import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { Download } from 'playwright';
import { CollisionMode, resolveCollision } from './collision';

// Filename generation moved to ./filename in Phase 2 (single source of truth).

export interface SaveResult {
  saved: boolean; // false = skipped because the file exists and mode is `skip`
  targetPath: string; // final absolute path (may be a `_vN` variant under `version` mode)
  filename: string; // final filename only (versioned if applicable)
  versioned: boolean; // true iff `version` mode picked a `_vN` name
}

/**
 * Persist the captured download to the target folder under the generated name (PRD §18, §37).
 * Collision handling (Phase 5) is decided by the pure `resolveCollision`, keyed on the EFFECTIVE
 * filename (only known after download — DECISIONS 2026-08-17):
 *   • skip      → the file exists → do not overwrite, return { saved:false }.
 *   • overwrite → save over the existing file.
 *   • version   → save under the first free `<name>_vN.xlsx`.
 * The PRE-download idempotency skip is separate (src/manifest/resume.ts).
 */
export async function saveDownload(
  download: Download,
  outputDirectory: string,
  filename: string,
  mode: CollisionMode,
): Promise<SaveResult> {
  const dir = path.resolve(outputDirectory);
  fs.mkdirSync(dir, { recursive: true });

  const decision = resolveCollision(filename, mode, (name) => fs.existsSync(path.join(dir, name)));
  const targetPath = path.join(dir, decision.finalName);

  if (decision.action === 'skip') {
    return { saved: false, targetPath, filename: decision.finalName, versioned: false };
  }
  await download.saveAs(targetPath);
  return { saved: true, targetPath, filename: decision.finalName, versioned: decision.versioned };
}

/**
 * Validate the downloaded file (PRD §25, checks 1–5). Throws INVALID_FILE on any failure so
 * a bad download can never be recorded as SUCCESS (AC-09). Specifically rejects an HTML
 * login/error page masquerading as a download by checking the XLSX (ZIP) magic bytes.
 */
export async function validateXlsx(filePath: string): Promise<void> {
  // Check 1 + 2: exists and non-empty.
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`INVALID_FILE: file does not exist at ${filePath}`);
  }
  if (stat.size === 0) {
    throw new Error(`INVALID_FILE: file is zero bytes at ${filePath}`);
  }

  // Check 3: extension.
  if (path.extname(filePath).toLowerCase() !== '.xlsx') {
    throw new Error(`INVALID_FILE: expected .xlsx extension, got "${path.extname(filePath)}"`);
  }

  // Check 5 (magic bytes): XLSX is a ZIP → first bytes are 50 4B 03 04. An HTML login/error
  // page would start with "<" (0x3C). Reject anything that is not a ZIP container.
  const head = readFirstBytes(filePath, 4);
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (!isZip) {
    throw new Error(
      `INVALID_FILE: not an XLSX (ZIP) container — likely an HTML login/error page. ` +
        `First bytes: ${[...head].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
    );
  }

  // Check 4: workbook actually opens.
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    if (wb.worksheets.length === 0) {
      throw new Error('workbook has no worksheets');
    }
  } catch (e) {
    throw new Error(`INVALID_FILE: workbook could not be opened (${(e as Error).message})`);
  }
}

function readFirstBytes(filePath: string, n: number): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}
