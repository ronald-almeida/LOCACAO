const { execFileSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
for (const file of ['api/create-pix.js', 'public/checkout.js', 'public/validation.js', 'public/assets/qrcode.js', 'scripts/dev.cjs']) {
  execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' });
}
const html = readFileSync(join(root, 'public/index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) {
  if (!existsSync(join(root, 'public', match[1]))) throw new Error(`Asset ausente: ${match[1]}`);
}
for (const forbidden of ['FIREBOT_API_KEY', 'payment-method-card', 'payment-method-bankslip']) {
  if (html.includes(forbidden)) throw new Error(`Conteúdo inesperado no checkout: ${forbidden}`);
}
console.log('Sintaxe e arquivos públicos verificados. Checkout pronto para build.');
