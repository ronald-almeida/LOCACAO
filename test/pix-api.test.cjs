const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, providerDiagnostic } = require('../api/create-pix');
const validation = require('../public/validation');
const qr = require('../public/assets/qrcode');

const env = { ATLAS_SECRET_KEY: 'atlas_sk_test_local_only', CHECKOUT_URL: 'https://checkout.example', NODE_ENV: 'production' };
const customer = { nome: 'Comprador de Teste', email: 'teste@example.invalid', cpf: '52998224725', celular: '11999998888' };
const pixCode = '00020101021226360014br.gov.bcb.pix0114teste-invalido5204000053039865406287.005802BR5910TESTE APENAS6009SAO PAULO62070503***6304ABCD';
const charge = { id: 'charge_test_123', object: 'charge', status: 'pending', method: 'pix', amount: 287, pix: { code: pixCode, expires_at: '2026-11-13T13:30:00+00:00' } };
function request(overrides = {}) { return { method: 'POST', headers: { 'content-type': 'application/json', origin: env.CHECKOUT_URL, 'idempotency-key': 'locacao-order-1042' }, body: customer, ...overrides }; }
function upstream(data, status = 200) { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) }; }
async function run(req, options = {}) {
  let sent;
  const calls = [];
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(data) { sent = data; } };
  const handler = createHandler({ env, logger: { error() {} }, fetchImpl: async (...args) => { calls.push(args); return upstream(charge); }, ...options });
  await handler(req, res);
  return { status: res.code, headers: res.headers, body: sent, calls };
}
test('envia R$ 287 fixos e usa o contrato Atlas Pags no servidor', async () => {
  const result = await run(request({ body: { ...customer, amount: 1, description: 'TAMPERED', checkout_url: 'https://evil.invalid' } }));
  assert.equal(result.status, 200);
  const [url, options] = result.calls[0];
  const payload = JSON.parse(options.body);
  assert.equal(url, 'https://atlaspags.com/api/v1/charges');
  assert.equal(payload.amount, 287);
  assert.equal(payload.method, 'pix');
  assert.equal(payload.checkout_url, 'https://checkout.example/');
  assert.equal(payload.description, 'BLACK INFINITA DA LOCAÇÃO');
  assert.equal(options.headers.authorization, `Bearer ${env.ATLAS_SECRET_KEY}`);
  assert.equal(options.headers['idempotency-key'], 'locacao-order-1042');
  assert.equal(options.headers['content-length'], String(Buffer.byteLength(options.body)));
  assert.equal(payload.customer.document, customer.cpf);
  assert.equal(result.body.pixCode, pixCode);
  assert.equal(result.body.transactionId, charge.id);
  assert.equal(result.body.qrCodeUrl, undefined);
  assert.equal(JSON.stringify(result.body).includes(env.ATLAS_SECRET_KEY), false);
  assert.match(result.headers['Cache-Control'], /no-store/);
});
test('não chama a Atlas Pags com configuração ausente', async () => {
  for (const incomplete of [{}, { CHECKOUT_URL: env.CHECKOUT_URL }, { ...env, CHECKOUT_URL: 'http://insecure.example' }]) {
    const result = await run(request(), { env: incomplete });
    assert.equal(result.status, 503); assert.equal(result.calls.length, 0);
  }
});
test('recusa outros métodos, tipo de conteúdo e origem externa', async () => {
  assert.equal((await run(request({ method: 'GET' }))).status, 405);
  assert.equal((await run(request({ headers: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await run(request({ headers: { 'content-type': 'application/json', origin: 'https://evil.invalid', 'idempotency-key': 'locacao-order-1042' } }))).status, 403);
  assert.equal((await run(request({ headers: { 'content-type': 'application/json', origin: env.CHECKOUT_URL, 'sec-fetch-site': 'cross-site', 'idempotency-key': 'locacao-order-1042' } }))).status, 403);
  const withoutIdempotency = await run(request({ headers: { 'content-type': 'application/json', origin: env.CHECKOUT_URL } }));
  assert.equal(withoutIdempotency.status, 400);
});
test('JSON malformado, arrays e corpo muito grande são recusados', async () => {
  for (const body of ['{', [], null, { nome: 'a'.repeat(9000) }]) assert.equal((await run(request({ body }))).status, 400);
});
test('validação dos dados impede chamadas de cobrança', async () => {
  for (const changes of [{ nome: '' }, { cpf: '11111111111' }, { cpf: '52998224724' }, { email: 'errado' }, { celular: '123' }]) {
    const result = await run(request({ body: { ...customer, ...changes } }));
    assert.equal(result.status, 400); assert.equal(result.calls.length, 0);
  }
});
test('normaliza CPF/CNPJ e dados formatados', () => {
  assert.equal(validation.validDocument('529.982.247-25'), true);
  assert.equal(validation.validDocument('11.222.333/0001-81'), true);
  assert.equal(validation.validDocument('11.222.333/0001-82'), false);
  assert.equal(validation.validDocument('00.000.000/0000-00'), false);
  assert.deepEqual(validation.normalize({ nome: '  Comprador  de Teste ', email: ' TESTE@EXAMPLE.INVALID ', cpf: '529.982.247-25', celular: '(11) 99999-8888' }), customer);
});
test('respostas Atlas inválidas ou com valor diferente nunca exibem Pix', async () => {
  for (const data of [
    { ...charge, amount: 2490.4 }, { ...charge, method: 'card' },
    { ...charge, pix: { ...charge.pix, code: '' } }, { ...charge, id: null },
    { ...charge, status: 'unknown' }, { ...charge, pix: { ...charge.pix, code: '<script>alert(1)</script>' } },
  ]) {
    const result = await run(request(), { fetchImpl: async () => upstream(data) });
    assert.equal(result.status, 502); assert.equal(result.body.pixCode, undefined);
  }
});
test('falhas do provedor não expõem credenciais nem retornam falso sucesso', async () => {
  for (const fetchImpl of [async () => { throw new Error(env.ATLAS_SECRET_KEY); }, async () => upstream({ detail: 'invalid key', error: { code: 'authentication_required' } }, 401), async () => upstream({}, 200)]) {
    const result = await run(request(), { fetchImpl });
    assert.equal(result.status, 502);
    assert.equal(JSON.stringify(result.body).includes(env.ATLAS_SECRET_KEY), false);
  }
});
test('biblioteca local gera QR do código retornado pelo gateway', () => {
  const code = qr(0, 'M'); code.addData(pixCode); code.make();
  assert.match(code.createDataURL(6, 24), /^data:image\/gif;base64,/);
  assert.ok(code.getModuleCount() >= 21);
});
test('diagnósticos de erro não incluem dados privados da resposta', () => {
  const diagnostic = providerDiagnostic({ error: { code: 'authentication_required', message: `invalid ${env.ATLAS_SECRET_KEY}`, request_id: 'req_safe_123' }, customer, token: 'secret-token' }, 401);
  assert.equal(diagnostic.category, 'authentication');
  assert.equal(diagnostic.httpStatus, 401);
  const serialized = JSON.stringify(diagnostic);
  for (const value of [env.ATLAS_SECRET_KEY, customer.cpf, customer.email, pixCode, 'secret-token']) assert.equal(serialized.includes(value), false);
  assert.equal(providerDiagnostic({ error: { code: 'validation_error' } }, 422).category, 'customer_validation');
  assert.equal(providerDiagnostic({ error: { code: 'rate_limited' } }, 429).category, 'rate_limit');
});
test('erros da Atlas são expostos ao checkout sem conteúdo sensível', async () => {
  const result = await run(request(), { fetchImpl: async () => upstream({ detail: 'internal details', error: { code: 'invalid_request', message: 'private account data' } }, 400) });
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'PIX_PROVIDER_REJECTED');
  assert.equal(JSON.stringify(result.body).includes('internal details'), false);
  assert.equal(JSON.stringify(result.body).includes('private account data'), false);
  assert.equal(result.body.pixCode, undefined);
});
