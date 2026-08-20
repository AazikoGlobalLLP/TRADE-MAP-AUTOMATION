import { strict as assert } from 'node:assert';
import { formatConsoleLine, prettyDuration } from './console';

// ---------------------------------------------------------------------------
// Console-formatter harness (Phase 10). Proves the emoji/console lines PURELY,
// with no browser and no I/O. Run: `npm run test:console`.
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    process.stdout.write(`  FAIL  ${name}\n`);
  }
}

process.stdout.write('\nprettyDuration:\n');
check('seconds only under a minute', () => assert.equal(prettyDuration(45000), '45s'));
check('minutes + zero-padded seconds', () => assert.equal(prettyDuration(134000), '2m14s'));
check('whole minute pads seconds', () => assert.equal(prettyDuration(60000), '1m00s'));

process.stdout.write('\nformatConsoleLine — country status lines carry emoji + name + status:\n');

check('SUCCESS → ✅ + country + range', () => {
  const line = formatConsoleLine('info', 'country.done', {
    country: 'India',
    status: 'SUCCESS',
    effectiveRange: '200704-202605',
    attempts: 2,
  })!;
  assert.match(line, /✅/);
  assert.match(line, /India/);
  assert.match(line, /SUCCESS/);
  assert.match(line, /200704-202605/);
  assert.match(line, /2 attempts/);
});

check('SKIPPED via country.done → ⏭ + SKIPPED', () => {
  const line = formatConsoleLine('info', 'country.done', { country: 'Brazil', status: 'SKIPPED' })!;
  assert.match(line, /⏭/);
  assert.match(line, /Brazil/);
  assert.match(line, /SKIPPED/);
});

check('resume skip → ⏭ + already done', () => {
  const line = formatConsoleLine('info', 'country.skip_resume', { country: 'Chile' })!;
  assert.match(line, /⏭/);
  assert.match(line, /Chile/);
  assert.match(line, /already done/i);
});

check('FAILED → ❌ + country + shortened error', () => {
  const line = formatConsoleLine('error', 'country.failed', { country: 'China', attempts: 3, error: 'DOWNLOAD_TIMEOUT: boom' })!;
  assert.match(line, /❌/);
  assert.match(line, /China/);
  assert.match(line, /FAILED/);
  assert.match(line, /DOWNLOAD_TIMEOUT/);
});

check('throttle → ⏸ + pretty duration + account note', () => {
  const line = formatConsoleLine('info', 'batch.throttle', { beforeCountry: 'Peru', pauseMs: 134000 })!;
  assert.match(line, /⏸/);
  assert.match(line, /2m14s/);
  assert.match(line, /account/i);
});

check('retry round → 🔁 + round + remaining count', () => {
  const line = formatConsoleLine('info', 'retry.round_start', { round: 2, of: 3, remaining: 7 })!;
  assert.match(line, /🔁/);
  assert.match(line, /2\/3/);
  assert.match(line, /7/);
});

check('summary → 📊 + counts', () => {
  const line = formatConsoleLine('info', 'batch.summary', { total: 10, success: 8, skipped: 1, failed: 1 })!;
  assert.match(line, /📊/);
  assert.match(line, /8 success/);
  assert.match(line, /1 skipped/);
  assert.match(line, /1 failed/);
});

process.stdout.write('\nformatConsoleLine — noise suppression + error safety:\n');

check('a noisy internal info event → null (file-only)', () => {
  assert.equal(formatConsoleLine('info', 'query.navigate', { country: 'India', url: 'x' }), null);
  assert.equal(formatConsoleLine('info', 'country.resolved', { country: 'India' }), null);
  assert.equal(formatConsoleLine('info', 'export.attempt', { country: 'India', attempt: 1 }), null);
});

check('an UNLISTED error-level event is never hidden (❗ + message)', () => {
  const line = formatConsoleLine('error', 'some.unknown_error', { error: 'kaboom' })!;
  assert.notEqual(line, null);
  assert.match(line, /❗/);
  assert.match(line, /kaboom/);
});

check('an unlisted warn/info event is suppressed (null)', () => {
  assert.equal(formatConsoleLine('warn', 'export.attempt_failed', { country: 'India' }), null);
});

process.stdout.write(`\nConsole harness: ${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write('ALL PASS\n');
