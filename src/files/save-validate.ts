import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { Download } from 'playwright';

/** Render the filename template (PRD §19–20). Unknown tokens are left untouched. */
export function generateFilename(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : whole,
  );
}

export interface SaveResult {
  saved: boolean; // false = skipped due to existing file + overwrite:false
  targetPath: string;
}

/**
 * Persist the captured download to the target folder under the generated name (PRD §18, §37).
 * Default collision behavior is skip-not-overwrite; versioning arrives in Phase 5.
 */
export async function saveDownload(
  download: Download,
  outputDirectory: string,
  filename: string,
  overwrite: boolean,
): Promise<SaveResult> {
  const dir = path.resolve(outputDirectory);
  fs.mkdirSync(dir, { recursive: true });
  const targetPath = path.join(dir, filename);

  if (fs.existsSync(targetPath) && !overwrite) {
    return { saved: false, targetPath };
  }
  await download.saveAs(targetPath);
  return { saved: true, targetPath };
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
