(function (root) {
  'use strict';
  const digits = value => String(value ?? '').replace(/\D/g, '');
  function validDocument(value) {
    const doc = digits(value);
    if (/^(\d)\1+$/.test(doc)) return false;
    if (doc.length === 11) {
      for (let size = 9; size <= 10; size++) {
        let sum = 0;
        for (let i = 0; i < size; i++) sum += Number(doc[i]) * (size + 1 - i);
        if ((sum * 10) % 11 % 10 !== Number(doc[size])) return false;
      }
      return true;
    }
    if (doc.length === 14) {
      for (let size = 12; size <= 13; size++) {
        let sum = 0, weight = size - 7;
        for (let i = 0; i < size; i++) {
          sum += Number(doc[i]) * weight;
          weight = weight === 2 ? 9 : weight - 1;
        }
        const remainder = sum % 11;
        if ((remainder < 2 ? 0 : 11 - remainder) !== Number(doc[size])) return false;
      }
      return true;
    }
    return false;
  }
  function normalize(input = {}) {
    const text = key => typeof input[key] === 'string' ? input[key].trim() : '';
    return {
      nome: text('nome').replace(/\s+/g, ' '),
      email: text('email').toLowerCase(),
      cpf: digits(text('cpf')),
      celular: digits(text('celular'))
    };
  }
  function errors(customer) {
    const result = {};
    if (customer.nome.length < 3 || customer.nome.length > 120 || !customer.nome.includes(' ')) result.nome = 'Informe o nome completo ou a razão social.';
    if (customer.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) result.email = 'Informe um e-mail válido.';
    if (!validDocument(customer.cpf)) result.cpf = 'Confira os dígitos do CPF ou CNPJ.';
    if (!/^[1-9]\d{9,10}$/.test(customer.celular)) result.celular = 'Informe o celular com DDD.';
    return result;
  }
  const api = { digits, validDocument, normalize, errors };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CheckoutValidation = api;
})(typeof window !== 'undefined' ? window : globalThis);
