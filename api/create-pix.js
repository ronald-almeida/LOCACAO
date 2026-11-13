'use strict';

const validation = require('../public/validation');
const AMOUNT = 287;
const DESCRIPTION = 'BLACK INFINITA DA LOCAÇÃO';
const ENDPOINT = 'https://firebotbr.com/api/v1/pix/create';

function reply(res, status, body) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

function providerDiagnostic(data, status) {
  const message = [data?.error, data?.message, data?.error?.message, data?.code]
    .filter(value => typeof value === 'string').join(' ').toLowerCase();
  let category = 'response_format';
  if (status === 401 || status === 403 || /api.?key|chave|unauthor|autentica|credencia/.test(message)) category = 'authentication';
  else if (/cpf|cnpj|customer|cliente|email|e-mail|phone|telefone|celular/.test(message)) category = 'customer_validation';
  else if (/storeurl|store.url|dom[ií]nio|domain|url.*loja/.test(message)) category = 'store_url';
  else if (/kyc|verifica|conta|account|habilita|ativad/.test(message)) category = 'account_configuration';
  else if (status === 429) category = 'rate_limit';
  else if (status >= 500) category = 'provider_unavailable';
  return {
    event: 'firebot_pix_rejected', httpStatus: status, category,
    success: data?.success === true,
    amountPresent: data?.amount !== undefined,
    amountMatches: Number(data?.amount) === AMOUNT,
    pixCodePresent: typeof data?.pixCopiaECola === 'string',
    pixCodeLength: typeof data?.pixCopiaECola === 'string' ? data.pixCopiaECola.trim().length : 0,
    transactionIdPresent: Boolean(data?.transactionId),
    nestedData: Boolean(data?.data && typeof data.data === 'object')
  };
}

function createHandler({ env = process.env, fetchImpl = (...args) => fetch(...args), logger = console } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return reply(res, 405, { error: 'Método não permitido.' });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      return reply(res, 415, { error: 'Envie os dados no formato JSON.' });
    }
    let storeUrl;
    try {
      storeUrl = new URL(env.CHECKOUT_URL);
      if (storeUrl.protocol !== 'https:' || storeUrl.username || storeUrl.password) throw new Error();
    } catch {
      return reply(res, 503, { error: 'O Pix está temporariamente indisponível. Entre em contato com o suporte.' });
    }
    if (!env.FIREBOT_API_KEY?.trim()) {
      return reply(res, 503, { error: 'O Pix está temporariamente indisponível. Entre em contato com o suporte.' });
    }
    const origin = req.headers.origin;
    const local = env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
    if (origin && origin !== storeUrl.origin && !local) {
      return reply(res, 403, { error: 'Origem não autorizada.' });
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return reply(res, 403, { error: 'Origem não autorizada.' });
    }
    let body = req.body;
    try {
      if (typeof body === 'string') body = JSON.parse(body);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 8192) throw new Error();
    } catch {
      return reply(res, 400, { error: 'Dados de pagamento inválidos.' });
    }
    const customer = validation.normalize(body);
    const errors = validation.errors(customer);
    if (Object.keys(errors).length) return reply(res, 400, { error: 'Confira os dados informados.', fields: errors });

    try {
      // O preço e a descrição nunca são aceitos do navegador.
      const upstream = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': env.FIREBOT_API_KEY.trim() },
        body: JSON.stringify({
          productType: 'DIGITAL', storeUrl: storeUrl.href, amount: AMOUNT,
          description: DESCRIPTION,
          customer: { name: customer.nome, email: customer.email, cpf: customer.cpf, phone: customer.celular },
          qrStyle: 'plain'
        }),
        signal: AbortSignal.timeout(18000),
        redirect: 'error'
      });
      const data = await upstream.json();
      const code = typeof data?.pixCopiaECola === 'string' ? data.pixCopiaECola.trim() : '';
      if (!upstream.ok || data?.success !== true || Number(data.amount) !== AMOUNT || !code.startsWith('000201') || code.length < 50 || code.length > 4096 || !data.transactionId) {
        logger.error(JSON.stringify(providerDiagnostic(data, upstream.status)));
        return reply(res, 502, { error: 'Não foi possível obter um Pix válido. Aguarde um momento e tente novamente.' });
      }
      // O QR é gerado localmente a partir do mesmo código. Nenhum dado é enviado a serviços de imagens.
      return reply(res, 200, { success: true, amount: AMOUNT, pixCode: code, transactionId: String(data.transactionId) });
    } catch (error) {
      logger.error(JSON.stringify({ event: 'firebot_pix_request_failed', category: error?.name === 'TimeoutError' ? 'timeout' : 'network_or_json' }));
      // Nunca registrar corpo da resposta, código Pix, dados pessoais ou credenciais.
      return reply(res, 502, { error: 'Não recebemos a resposta do serviço Pix. Aguarde um momento antes de tentar novamente.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.providerDiagnostic = providerDiagnostic;
