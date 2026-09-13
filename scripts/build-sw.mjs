import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const dist = 'dist';
const p404 = join(dist, '404.html');
if (existsSync(p404)) {
  const content = readFileSync(p404, 'utf8').replace(/<link rel="stylesheet"[^>]*>\s*/g, '');
  writeFileSync(p404, content);
}

const swSrc = 'src/sw.js';
const swDest = join(dist, 'sw.js');

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

const assets = walk(dist)
  .filter(f => !f.endsWith('.map') && !f.endsWith('.br') && !f.endsWith('.gz'))
  .map(f => '/' + relative(dist, f))
  .sort();

const swCode = readFileSync(swSrc, 'utf8');
const version = sha256(assets.join(',') + swCode).slice(0, 12);
const output = swCode
  .replace('__CACHE_NAME__', `t4a-${version}`)
  .replace('__PRECACHE_ASSETS__', JSON.stringify(assets, null, 2));

writeFileSync(swDest, output);
console.log(`Service worker built: ${version}, ${assets.length} assets`);
