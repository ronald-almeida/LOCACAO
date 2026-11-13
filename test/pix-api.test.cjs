const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, providerDiagnostic } = require('../api/create-pix');
const validation = require('../public/validation');
const qr = require('../public/assets/qrcode');

const env = { FIREBOT_API_KEY: 'test-only-secret', CHECKOUT_URL: 'https://checkout.example', NODE_ENV: 'production' };
const customer = { nome: 'Comprador de Teste', email: 'teste@example.invalid', cpf: '52998224725', celular: '11999998888' };
const pixCode = '00020101021226360014br.gov.bcb.pix0114teste-invalido5204000053039865406287.005802BR5910TESTE APENAS6009SAO PAULO62070503***6304ABCD';
const gateway = { success: true, amount: 287, pixCopiaECola: pixCode, transactionId: 'fire_tx_test', qrCodeUrl: 'https://example.invalid/not-used' };
function request(overrides = {}) { return { method: 'POST', headers: { 'content-type': 'application/json', origin: env.CHECKOUT_URL }, body: customer, ...overrides }; }
async function run(req, options = {}) {
  let sent;
  const calls = [];
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(data) { sent = data; } };
  const handler = createHandler({ env, logger: { error() {} }, fetchImpl: async (...args) => { calls.push(args); return { ok: true, status: 200, json: async () => gateway }; }, ...options });
  await handler(req, res);
  return { status: res.code, headers: res.headers, body: sent, calls };
}
test('envia R$ 287 fixos, produto digital e autenticação somente ao Firebot', async () => {
  const result = await run(request({ body: { ...customer, amount: 1, description: 'TAMPERED', storeUrl: 'https://evil.invalid' } }));
  assert.equal(result.status, 200);
  const [url, options] = result.calls[0];
  const payload = JSON.parse(options.body);
  assert.equal(url, 'https://firebotbr.com/api/v1/pix/create');
  assert.equal(payload.amount, 287);
  assert.equal(payload.productType, 'DIGITAL');
  assert.equal(payload.storeUrl, 'https://checkout.example/');
  assert.equal(payload.description, 'BLACK INFINITA DA LOCAÇÃO');
  assert.equal(options.headers['x-api-key'], env.FIREBOT_API_KEY);
  assert.equal(payload.customer.cpf, customer.cpf);
  assert.equal(result.body.pixCode, pixCode);
  assert.equal(result.body.qrCodeUrl, undefined);
  assert.equal(JSON.stringify(result.body).includes(env.FIREBOT_API_KEY), false);
  assert.match(result.headers['Cache-Control'], /no-store/);
});
test('não chama gateway com configuração ausente', async () => {
  for (const incomplete of [{}, { CHECKOUT_URL: env.CHECKOUT_URL }, { ...env, CHECKOUT_URL: 'http://insecure.example' }]) {
    const result = await run(request(), { env: incomplete });
    assert.equal(result.status, 503); assert.equal(result.calls.length, 0);
  }
});
test('recusa outros métodos, tipo de conteúdo e origem externa', async () => {
  assert.equal((await run(request({ method: 'GET' }))).status, 405);
  assert.equal((await run(request({ headers: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await run(request({ headers: { 'content-type': 'application/json', origin: 'https://evil.invalid' } }))).status, 403);
  assert.equal((await run(request({ headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } }))).status, 403);
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
test('respostas Firebot inválidas ou com valor diferente nunca exibem Pix', async () => {
  for (const data of [{ ...gateway, amount: 2490.4 }, { ...gateway, success: false }, { ...gateway, pixCopiaECola: '' }, { ...gateway, transactionId: null }, { ...gateway, pixCopiaECola: '<script>alert(1)</script>' }, null]) {
    const result = await run(request(), { fetchImpl: async () => ({ ok: true, json: async () => data }) });
    assert.equal(result.status, 502); assert.equal(result.body.pixCode, undefined);
  }
});
test('falhas do provedor não expõem credenciais nem retornam falso sucesso', async () => {
  for (const fetchImpl of [async () => { throw new Error('test-only-secret'); }, async () => ({ ok: false, json: async () => gateway }), async () => ({ ok: true, json: async () => { throw new Error(); } })]) {
    const result = await run(request(), { fetchImpl });
    assert.equal(result.status, 502);
    assert.equal(JSON.stringify(result.body).includes('test-only-secret'), false);
  }
});
test('biblioteca local gera QR do código retornado pelo gateway', () => {
  const code = qr(0, 'M'); code.addData(pixCode); code.make();
  assert.match(code.createDataURL(6, 24), /^data:image\/gif;base64,/);
  assert.ok(code.getModuleCount() >= 21);
});
test('diagnóstico separa autenticação, dados e formato sem divulgar valores sensíveis', () => {
  const diagnostic = providerDiagnostic({ ...gateway, error: 'Invalid API key test-only-secret', customer, token: 'secret-token' }, 401, [env.FIREBOT_API_KEY, ...Object.values(customer)]);
  assert.equal(diagnostic.category, 'authentication');
  assert.equal(diagnostic.httpStatus, 401);
  const serialized = JSON.stringify(diagnostic);
  for (const value of [env.FIREBOT_API_KEY, customer.cpf, customer.email, pixCode, 'secret-token']) assert.equal(serialized.includes(value), false);
  assert.equal(providerDiagnostic({ message: 'CPF invalido' }, 400).category, 'customer_validation');
  assert.equal(providerDiagnostic({ success: true, transactionId: 'id', pixCopiaECola: pixCode }, 200).amountPresent, false);
});
test('recusa PixGateIP é identificada como falha do processador, sem confundir contato com conta', async () => {
  const failure = { success: false, error: 'PixGateIP: Não foi possível gerar o PIX no momento. Entre em contato com o suporte.' };
  assert.equal(providerDiagnostic(failure, 400).category, 'payment_processor');
  assert.equal(providerDiagnostic({ error: 'Entre em contato com o suporte.' }, 400).category, 'response_format');
  const result = await run(request(), { fetchImpl: async () => ({ ok: false, status: 400, json: async () => failure }) });
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'PIX_PROVIDER_REJECTED');
  assert.match(result.body.error, /serviço de pagamento/);
  assert.equal(result.body.pixCode, undefined);
});
