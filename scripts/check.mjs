import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = 'src';
const maxLines = 500;
const extensions = new Set(['.js', '.mjs', '.css']);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (extensions.has(extname(path))) files.push(path);
  }
  return files;
}

const files = walk(root);
const violations = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n').length;
  if (lines > maxLines) violations.push({ file, lines });
}

if (violations.length) {
  console.error('Code files exceed 500 lines:');
  violations.forEach(v => console.error(`  ${v.file}: ${v.lines} lines`));
  process.exit(1);
}

console.log(`All ${files.length} code files within limit.`);
