'use strict';

const form = document.querySelector('#checkout-form');
const payButton = document.querySelector('#pay-button');
const payLabel = document.querySelector('#pay-label');
const formError = document.querySelector('#form-error');
const dialog = document.querySelector('#pix-dialog');
const pixCode = document.querySelector('#pix-code');
const qrImage = document.querySelector('#qr-code');
const copyButton = document.querySelector('#copy-button');
const copyStatus = document.querySelector('#copy-status');
const fields = ['nome', 'cpf', 'email', 'confirm-email', 'celular'];
let pending = false;
let currentPix = null;
let idempotencyKey = '';
let idempotencyFingerprint = '';
let copyTimer;

function fieldError(id, message) {
  document.getElementById(id).setAttribute('aria-invalid', message ? 'true' : 'false');
  document.getElementById(`${id}-error`).textContent = message || '';
}
fields.forEach(id => document.getElementById(id).addEventListener('input', () => fieldError(id, '')));

document.getElementById('cpf').addEventListener('input', event => {
  const digits = CheckoutValidation.digits(event.target.value).slice(0, 14);
  event.target.value = digits.length <= 11
    ? digits.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    : digits.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
});
document.getElementById('celular').addEventListener('input', event => {
  const value = CheckoutValidation.digits(event.target.value).slice(0, 11);
  event.target.value = value.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4,5})(\d{4})$/, '$1-$2');
});

function openPix() {
  clearTimeout(copyTimer);
  pixCode.value = currentPix.pixCode;
  copyButton.textContent = 'Copiar código Pix';
  copyStatus.textContent = '';
  qrImage.hidden = true;
  document.querySelector('#qr-error').hidden = true;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(currentPix.pixCode);
    qr.make();
    qrImage.src = qr.createDataURL(6, 24);
    qrImage.hidden = false;
  } catch {
    document.querySelector('#qr-error').hidden = false;
  }
  dialog.showModal();
  document.body.classList.add('modal-open');
  copyButton.focus();
}
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const bounds = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
});
dialog.addEventListener('close', () => {
  document.body.classList.remove('modal-open');
  payButton.focus();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending) return;
  fields.forEach(id => fieldError(id, ''));
  formError.hidden = true;
  const data = CheckoutValidation.normalize(Object.fromEntries(new FormData(form)));
  const errors = CheckoutValidation.errors(data);
  if (document.querySelector('#confirm-email').value.trim().toLowerCase() !== data.email) errors['confirm-email'] = 'Os e-mails precisam ser iguais.';
  if (Object.keys(errors).length) {
    Object.entries(errors).forEach(([id, message]) => fieldError(id, message));
    document.getElementById(Object.keys(errors)[0]).focus();
    return;
  }
  const fingerprint = JSON.stringify(data);
  if (fingerprint !== idempotencyFingerprint) {
    idempotencyFingerprint = fingerprint;
    idempotencyKey = crypto.randomUUID();
  }
  // Reabrir o modal não cria outra cobrança na mesma sessão da página.
  if (currentPix) { openPix(); return; }
  pending = true;
  payButton.disabled = true;
  payButton.setAttribute('aria-busy', 'true');
  payLabel.textContent = 'Gerando seu Pix…';
  try {
    const response = await fetch('/api/create-pix', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(data), signal: AbortSignal.timeout(22000)
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('O serviço Pix está indisponível. Tente novamente em instantes.'); }
    if (!response.ok || result.success !== true) {
      if (result.fields) Object.entries(result.fields).filter(([id]) => fields.includes(id)).forEach(([id, message]) => fieldError(id, message));
      throw new Error(result.error || 'Não foi possível gerar o Pix.');
    }
    if (result.amount !== 287 || typeof result.pixCode !== 'string' || !result.pixCode.trim()) throw new Error('O serviço não retornou o Pix esperado. Entre em contato com o suporte.');
    currentPix = result;
    fields.forEach(id => { document.getElementById(id).readOnly = true; });
    openPix();
  } catch (error) {
    formError.textContent = error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'A geração demorou mais que o esperado. Aguarde um momento antes de tentar novamente.'
      : error instanceof TypeError ? 'Verifique sua conexão e tente novamente em instantes.' : error.message;
    formError.hidden = false;
  } finally {
    pending = false;
    payButton.disabled = false;
    payButton.removeAttribute('aria-busy');
    payLabel.textContent = currentPix ? 'Ver QR code e código Pix' : 'Pagar e Receber Agora';
  }
});

copyButton.addEventListener('click', async () => {
  if (!currentPix) return;
  let copied = false;
  try { await navigator.clipboard.writeText(currentPix.pixCode); copied = true; } catch {
    pixCode.focus();
    pixCode.select();
    pixCode.setSelectionRange(0, pixCode.value.length);
    try { copied = document.execCommand('copy'); } catch { /* Seleção manual permanece disponível. */ }
  }
  copyButton.textContent = copied ? 'Copiado!' : 'Copiar código Pix';
  copyStatus.textContent = copied ? 'Código copiado. Agora, cole no aplicativo do seu banco.' : 'Selecione o código acima e use a opção Copiar do seu dispositivo.';
  if (copied) { copyButton.focus(); clearTimeout(copyTimer); copyTimer = setTimeout(() => { copyButton.textContent = 'Copiar código Pix'; }, 3500); }
});
