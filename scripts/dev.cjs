'use strict';
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname, sep } = require('node:path');
const handler = require('../api/create-pix');
const root = resolve(__dirname, '../public');
const demo = process.argv.includes('--demo');
const port = Number(process.env.PORT || 38762);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
http.createServer(async (req, res) => {
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/create-pix') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 8192) return res.status(413).json({ error: 'Dados excedem o tamanho permitido.' });
      }
      req.body = body;
      if (demo && req.method === 'POST') {
        return res.status(200).json({ success: true, amount: 287, pixCode: 'DEMONSTRACAO SEM VALOR - BLACK INFINITA DA LOCACAO - R$ 287,00 - NAO PAGAR', transactionId: 'demo-local' });
      }
      return await handler(req, res);
    }
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) return res.status(403).end();
    let content = await readFile(path);
    if (demo && extname(path) === '.html') content = Buffer.from(content.toString().replace('class="demo-notice" hidden', 'class="demo-notice"'));
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.status(404).end('Página não encontrada'); }
}).listen(port, '127.0.0.1', () => console.log(`Checkout ${demo ? '(DEMONSTRAÇÃO)' : ''}: http://127.0.0.1:${port}`));
