'use strict';

const validation = require('../public/validation');
const AMOUNT = 287;
const DESCRIPTION = 'BLACK INFINITA DA LOCAÇÃO';
const API_URL = 'https://atlaspags.com/api/v1/charges';

function reply(res, status, body) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

function providerDiagnostic(data, status) {
  const providerError = data?.error;
  const errorCode = typeof providerError?.code === 'string' && /^[a-z0-9_]{1,80}$/i.test(providerError.code)
    ? providerError.code : undefined;
  const category = status === 401 ? 'authentication'
    : status === 403 ? 'account_configuration'
      : status === 422 ? 'customer_validation'
        : status === 429 ? 'rate_limit'
          : status >= 500 ? 'provider_unavailable' : 'request_rejected';
  const requestId = typeof providerError?.request_id === 'string' && /^[a-z0-9_-]{1,80}$/i.test(providerError.request_id)
    ? providerError.request_id : undefined;
  return { event: 'atlas_pix_rejected', httpStatus: status, category, ...(errorCode ? { errorCode } : {}), ...(requestId ? { requestId } : {}) };
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
    const secretKey = env.ATLAS_SECRET_KEY?.trim();
    if (!secretKey?.startsWith('atlas_sk_')) {
      return reply(res, 503, { error: 'O Pix está temporariamente indisponível. Entre em contato com o suporte.' });
    }
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
      return reply(res, 400, { error: 'Não foi possível identificar esta tentativa. Atualize a página e tente novamente.' });
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

    const payload = {
      amount: AMOUNT,
      method: 'pix',
      description: DESCRIPTION,
      checkout_url: storeUrl.href,
      customer: { name: customer.nome, email: customer.email, document: customer.cpf, phone: customer.celular },
    };
    const serialized = JSON.stringify(payload);
    try {
      const upstream = await fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${secretKey}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(serialized)),
          'idempotency-key': idempotencyKey,
        },
        body: serialized,
        signal: AbortSignal.timeout(18000),
        redirect: 'error',
      });
      const text = await upstream.text();
      if (text.length > 65536) throw new Error('provider_response_too_large');
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('provider_response_invalid'); }
      if (!upstream.ok) {
        const diagnostic = providerDiagnostic(data, upstream.status);
        logger.error(JSON.stringify(diagnostic));
        return reply(res, 502, {
          error: diagnostic.category === 'provider_unavailable' || diagnostic.category === 'rate_limit'
            ? 'O serviço de pagamento está indisponível. Aguarde um momento e tente novamente.'
            : 'Não foi possível gerar o Pix. Confira os dados e entre em contato com o suporte.',
          code: 'PIX_PROVIDER_REJECTED',
        });
      }
      const code = typeof data?.pix?.code === 'string' ? data.pix.code.trim() : '';
      const validId = typeof data?.id === 'string' && /^[A-Za-z0-9._~-]{1,128}$/.test(data.id);
      if (!validId || data.method !== 'pix' || !['pending', 'paid'].includes(data.status) || Number(data.amount) !== AMOUNT || !code.startsWith('000201') || code.length < 50 || code.length > 4096) {
        logger.error(JSON.stringify(providerDiagnostic(data, upstream.status)));
        return reply(res, 502, { error: 'Não foi possível validar o Pix recebido. Entre em contato com o suporte.' });
      }
      // O QR é gerado localmente a partir do código Pix retornado pela Atlas Pags.
      return reply(res, 200, { success: true, amount: AMOUNT, pixCode: code, transactionId: data.id, status: data.status });
    } catch (error) {
      logger.error(JSON.stringify({ event: 'atlas_pix_request_failed', category: error?.name === 'TimeoutError' ? 'timeout' : 'network_or_response' }));
      // Nunca registrar corpo da resposta, código Pix, dados pessoais ou credenciais.
      return reply(res, 502, { error: 'Não recebemos a resposta do serviço Pix. Aguarde um momento antes de tentar novamente.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.providerDiagnostic = providerDiagnostic;
