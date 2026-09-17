import { readdirSync, readFileSync, statSync, appendFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const maxLines = 500;
const extensions = new Set(['.js', '.mjs', '.cjs', '.css']);
const ignoredDirs = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.cache',
  '.system_generated',
  'tests',
]);

function walk(dir = '.', files = []) {
  for (const name of readdirSync(dir)) {
    if (ignoredDirs.has(name)) continue;
    const path = dir === '.' ? name : join(dir, name);
    try {
      const st = statSync(path);
      if (st.isDirectory()) {
        walk(path, files);
      } else if (extensions.has(extname(path))) {
        files.push(path);
      }
    } catch {}
  }
  return files;
}

const files = walk('.');
files.sort();
const violations = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n').length;
  if (lines > maxLines) violations.push({ file, lines });
}

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    if (violations.length) {
      const rows = violations.map(v => `| \`${v.file}\` | ${v.lines} | ${maxLines} | ❌ Exceeded |`).join('\n');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ❌ Code Line Limit Violations\n\n| File | Lines | Limit | Status |\n| :--- | :---: | :---: | :---: |\n${rows}\n`);
    } else {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ✅ Code Line Limits Passed\n\nAll **${files.length}** application code files are strictly within the **${maxLines}-line** limit.\n`);
    }
  } catch {}
}

if (violations.length) {
  console.error(`Code files exceed ${maxLines} lines limit:`);
  violations.forEach(v => {
    console.error(`  ${v.file}: ${v.lines} lines`);
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::error file=${v.file},line=${v.lines}::File exceeds ${maxLines} lines limit (${v.lines} lines)`);
    }
  });
  process.exit(1);
}

console.log(`All ${files.length} application code files within limit.`);
