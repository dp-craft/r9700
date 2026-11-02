// PROBE-ONLY: W2-04 D2 fake spec, minimal — enough to show plan exhaustion on call 2.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const plan = JSON.parse(readFileSync(process.env.FAKE_SP_PLAN, 'utf8'));
const counterFile = process.env.FAKE_SP_PLAN + '.counter';
const n = existsSync(counterFile) ? Number(readFileSync(counterFile, 'utf8')) : 0;
const entry = plan[n];
writeFileSync(counterFile, String(n + 1));
mkdirSync(process.env.FAKE_SP_DIR, { recursive: true });
mkdirSync(process.env.FAKE_SP_DIR + '/paused', { recursive: true });
process.exit(entry.exit);
