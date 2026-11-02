// W2-04 D2 fake, core logic verbatim: plan[n] via counter, process.exit(entry.exit)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const plan = JSON.parse(readFileSync(process.env.FAKE_SP_PLAN));
const counterFile = process.env.FAKE_SP_PLAN + '.counter';
let n = 0; try { n = Number(readFileSync(counterFile, 'utf8')); } catch {}
const entry = plan[n]; writeFileSync(counterFile, String(n + 1));
mkdirSync(process.env.FAKE_SP_DIR, { recursive: true });
process.exit(entry.exit);
