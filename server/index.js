import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { handleSsrRequest, load404HtmlTemplate } from './ssr.js';

const app = createApp(process.env);
const port = process.env.PORT || 3000;
const distPath = resolve(process.cwd(), 'dist');

// Serve compiled static assets
if (existsSync(distPath)) {
  app.use(express.static(distPath, { index: false }));
}

// Serve SSR HTML for entry pages
app.get(['/', '/index.html'], (req, res) => handleSsrRequest(req, res, process.env));

// 404 Fallback
app.use((req, res) => {
  res.status(404).type('text/html; charset=utf-8').send(load404HtmlTemplate({ serverEnv: process.env }));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Teach4All Express server listening on http://0.0.0.0:${port}`);
});
