import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createReply } from '../src/replies.js';

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

test('client code never references OPENROUTER_API_KEY or embeds secret tokens', () => {
  const root = 'src';
  function walk(dir, files = []) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, files);
      else if (name.endsWith('.js')) files.push(path);
    }
    return files;
  }

  const files = walk(root);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert(!content.includes('OPENROUTER_API_KEY'), `${file} must not reference OPENROUTER_API_KEY`);
    assert(!content.includes('sk-or-'), `${file} must not contain any OpenRouter API key tokens`);
  }
});

test('montserrat typography enforced in base styles without external fonts', () => {
  const baseCss = readFileSync('src/styles/base.css', 'utf8');
  assert.ok(baseCss.includes("'Montserrat'"), 'base.css must define Montserrat');
  assert.ok(!baseCss.includes('@font-face'), 'must not load remote font faces');
  assert.ok(!baseCss.includes('fonts.googleapis.com'), 'must not link google fonts');
});

test('offline standalone companion generates deterministic replies with zero external dependencies', () => {
  const prompts = [
    'Explain photosynthesis simply',
    'Make a study plan for this week',
    'Give me a creative story prompt',
    'Show me how to solve a math problem',
    'Teach me something new',
    'Just taking personal notes',
  ];

  for (const prompt of prompts) {
    const reply = createReply(prompt);
    assert.ok(typeof reply === 'string' && reply.length > 50, `reply for "${prompt}" should be comprehensive`);
  }

  // Verify photosynthesis offline prompt specifically matches expected content
  const photoReply = createReply('Explain photosynthesis simply');
  assert.ok(photoReply.includes('photosynthesis'), 'reply must explain photosynthesis');
  assert.ok(photoReply.includes('solar-powered kitchen'), 'reply must include intuitive explanation');
});

test('.env.example documents valid ENV options and update banner is removed from all envs', () => {
  const envExample = readFileSync('.env.example', 'utf8');
  assert.ok(envExample.includes('ENV='), '.env.example must define ENV');
  assert.ok(envExample.includes('production') && envExample.includes('development'), '.env.example must specify valid options');

  const mainContent = readFileSync('src/main.js', 'utf8');
  assert.strictEqual(mainContent.includes('Versi terbaru Teach4All telah siap.'), false, 'Update banner text must be removed from main.js');
});


