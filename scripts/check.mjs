import { readdirSync, readFileSync, statSync } from 'node:fs';
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

if (violations.length) {
  console.error(`Code files exceed ${maxLines} lines limit:`);
  violations.forEach(v => console.error(`  ${v.file}: ${v.lines} lines`));
  process.exit(1);
}

console.log(`All ${files.length} application code files within limit.`);
