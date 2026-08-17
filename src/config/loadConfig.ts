import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, validateConfig } from './schema';

/**
 * Read, parse, and validate config.json into a typed AppConfig (PRD §8/§13/§20).
 * Every failure surface is a single `CONFIG_INVALID: …` error so a bad config is
 * caught BEFORE a browser launches — never a half-configured run. Nothing here is
 * hardcoded business logic; this only turns the file into a validated object.
 */
export function loadConfig(configPath: string): AppConfig {
  const abs = path.resolve(configPath);

  let raw: string;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw new Error(`CONFIG_INVALID: cannot read config file at ${abs} — ${(e as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`CONFIG_INVALID: ${abs} is not valid JSON — ${(e as Error).message}`);
  }

  return validateConfig(parsed);
}
