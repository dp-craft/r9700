// PROBE-ONLY: eslint without fix — prints every message (rule, line, severity).
const { ESLint } = require('/home/dev/work/dippe/dpf-bench-replay/node_modules/eslint');
const file = process.argv[2];
const code = require('fs').readFileSync(process.argv[3], 'utf8');
const e = new ESLint({ overrideConfigFile: '/home/dev/work/dippe/dpf-bench-replay/eslint.config.mjs' });
(async () => {
  const r = await e.lintText(code, { filePath: file });
  for (const m of r[0].messages) console.log(`L${m.line}:${m.column} ${m.severity === 2 ? 'ERROR' : 'warn '} ${m.ruleId}: ${m.message}`);
  console.log(`total: ${r[0].errorCount} error(s), ${r[0].warningCount} warning(s)`);
})().catch((err) => { console.error(err.message); process.exit(1); });
