import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

test('all code files under 500 lines', () => {
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
  assert(files.length > 0, 'should find source files');

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n').length;
    assert(lines <= maxLines, `${file} has ${lines} lines, max is ${maxLines}`);
  }
});

test('no CDN imports in source', () => {
  const root = 'src';
  const cdnPatterns = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];

  function walk(dir, files = []) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, files);
      else files.push(path);
    }
    return files;
  }

  const files = walk(root).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of cdnPatterns) {
      assert(!content.includes(pattern), `${file} contains CDN reference: ${pattern}`);
    }
  }
});

test('no external font imports', () => {
  const root = 'src';
  const fontPatterns = ['fonts.googleapis.com', 'fonts.gstatic.com', '@font-face'];

  function walk(dir, files = []) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, files);
      else files.push(path);
    }
    return files;
  }

  const files = walk(root).filter(f => f.endsWith('.css'));

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of fontPatterns) {
      assert(!content.includes(pattern), `${file} contains external font: ${pattern}`);
    }
  }
});

test('package.json has correct scripts', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert(pkg.scripts.dev, 'should have dev script');
  assert(pkg.scripts.build, 'should have build script');
  assert(pkg.scripts.check, 'should have check script');
  assert(pkg.scripts.test, 'should have test script');
});

test('manifest.webmanifest valid JSON', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert(manifest.name, 'should have name');
  assert(manifest.start_url, 'should have start_url');
  assert(manifest.icons, 'should have icons');
});
