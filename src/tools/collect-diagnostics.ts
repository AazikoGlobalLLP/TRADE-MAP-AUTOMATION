import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Diagnostics collector (support tool). Bundles EVERYTHING needed to diagnose a
// run on ANOTHER machine (a friend's PC) into ONE plain-text file the author can
// read — with NO secrets. It reads only: environment, the git commit (to check
// the machine actually has the latest fixes), the manifests (run state), and the
// tail of the newest run log. It NEVER reads .auth/, browser-profile/, cookies,
// or tokens. Run:  npm run diagnose   → writes diagnostics-report.txt
//
// WHY it exists: the author cannot reach a friend's PC directly. The friend runs
// this one command and sends the single file back; that file shows whether they
// pulled the latest code and exactly which error each country hit.
// ---------------------------------------------------------------------------

const lines: string[] = [];
const add = (s = ''): void => void lines.push(s);
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

add('# Trade Map Automation — Diagnostics Report');
add(`Generated: ${new Date().toISOString()}`);
add('');

add('## 1. Environment');
add(`node: ${process.version}`);
add(`platform: ${process.platform} ${process.arch}`);
add(`cwd: ${process.cwd()}`);
add('');

add('## 2. Code version  (is this machine on the LATEST code? `git pull` if not)');
add(`git commit : ${safe(() => execSync('git rev-parse --short HEAD').toString().trim(), '(no git)')}`);
add(`latest log : ${safe(() => execSync('git log -1 --oneline').toString().trim(), '(no git)')}`);
add(`branch     : ${safe(() => execSync('git rev-parse --abbrev-ref HEAD').toString().trim(), '(no git)')}`);
add(`dist built : ${fs.existsSync('dist/index.js') ? 'yes' : 'NO — run `npm run build`'}`);
add(`chromium   : ${fs.existsSync(path.join(process.env.USERPROFILE || process.env.HOME || '', 'AppData', 'Local', 'ms-playwright')) || fs.existsSync(path.join(process.env.HOME || '', '.cache', 'ms-playwright')) ? 'likely installed' : 'unknown (run `npx playwright install chromium` if missing)'}`);
add('');

add('## 3. Config files present');
for (const f of safe(() => fs.readdirSync('config').filter((x) => x.endsWith('.json')), [] as string[])) {
  add(`- config/${f}`);
}
add('');

add('## 4. Run state (manifests) — how many done / failed, and why');
for (const f of safe(() => fs.readdirSync('manifests').filter((x) => x.endsWith('.json')), [] as string[])) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join('manifests', f), 'utf8'));
    const countries: Array<{ status?: string; error?: string }> = m.countries || [];
    const by: Record<string, number> = {};
    for (const c of countries) by[c.status || '?'] = (by[c.status || '?'] || 0) + 1;
    add(`- ${f}: ${countries.length} countries — ${JSON.stringify(by)}`);
    const errs: Record<string, number> = {};
    for (const c of countries) if (c.status === 'FAILED') {
      const k = (c.error || '').split(':')[0].slice(0, 50) || '(no message)';
      errs[k] = (errs[k] || 0) + 1;
    }
    if (Object.keys(errs).length) add(`    FAILED reasons: ${JSON.stringify(errs)}`);
  } catch (e) {
    add(`- ${f}: (unreadable — ${(e as Error).message})`);
  }
}
add('');

add('## 5. Newest run log — last 200 lines (full JSON, no secrets)');
const logsDir = 'logs/runs';
const newest = safe(() => {
  const files = fs
    .readdirSync(logsDir)
    .filter((x) => x.endsWith('.log'))
    .map((x) => ({ x, t: fs.statSync(path.join(logsDir, x)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? files[0].x : null;
}, null as string | null);
if (newest) {
  add(`file: logs/runs/${newest}`);
  const content = fs.readFileSync(path.join(logsDir, newest), 'utf8').trim().split(/\r?\n/);
  add(content.slice(-200).join('\n'));
} else {
  add('(no run logs found — has a run been started on this machine?)');
}
add('');

add('## 6. Output folder');
add(`.xlsx files in ./output: ${safe(() => fs.readdirSync('output').filter((x) => x.endsWith('.xlsx')).length, 0)}`);
add('');
add('--- end of report — send THIS file (diagnostics-report.txt). It contains NO passwords, cookies, or tokens. ---');

const outPath = path.resolve('diagnostics-report.txt');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
process.stdout.write(`\n✅ Wrote ${outPath}\n`);
process.stdout.write('   Send THIS single file to whoever is helping — it has NO passwords/cookies, only\n');
process.stdout.write('   your code version, run state, and error log.\n\n');
