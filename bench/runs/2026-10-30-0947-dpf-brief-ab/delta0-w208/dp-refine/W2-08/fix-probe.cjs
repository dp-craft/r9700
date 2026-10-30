const { ESLint } = require('/home/dev/work/dippe/dpf-bench-replay/node_modules/eslint');
const file = process.argv[2];
const code = require('fs').readFileSync(process.argv[3], 'utf8');
const e = new ESLint({ fix: true, overrideConfigFile: '/home/dev/work/dippe/dpf-bench-replay/eslint.config.mjs' });
(async () => {
  const r = await e.lintText(code, { filePath: file });
  process.stdout.write('=== FIXED SOURCE ===\n');
  process.stdout.write(r[0].output);
  console.log('=== remaining import-sort issues:', r[0].messages.filter(m => m.ruleId === 'simple-import-sort/imports').length);
})().catch(err => { console.error(err.message); process.exit(1); });
