# Checkout Black Infinita da Locação

Checkout responsivo com a identidade visual da página fornecida, preço único de **R$ 287,00**, pagamento exclusivamente por Pix, modal com QR code e botão de copiar.

## Firebot

A função `api/create-pix.js` usa `POST https://firebotbr.com/api/v1/pix/create`, conforme [documentação oficial](https://firebotbr.com/integracoes/docs):

- Autenticação `x-api-key`, exclusivamente no servidor.
- `productType: DIGITAL`, `amount: 287` em reais, descrição fixa e URL HTTPS do checkout.
- Dados obrigatórios: nome, e-mail, CPF/CNPJ e celular. Endereço dispensado para produto digital, conforme documentação.
- O QR code é gerado localmente a partir de `pixCopiaECola`, sem depender de um serviço externo de imagens.
- A resposta com preço divergente é rejeitada. Gerar ou copiar o Pix não é tratado como confirmação de pagamento.

## Configuração na Vercel

Importe `ronald-almeida/LOCACAO`, framework **Other**, Node **24.x**. O arquivo `vercel.json` configura o build e a pasta pública.

Defina em Settings → Environment Variables:

| Variável | Valor |
| --- | --- |
| `FIREBOT_API_KEY` | Chave privada da conta Firebot, como Secret, somente em Production |
| `CHECKOUT_URL` | URL HTTPS pública e canônica deste checkout |

Após alterar as variáveis, faça um novo deploy. Nunca coloque a chave em arquivos públicos ou no Git. A API responde 503 enquanto faltar configuração.

## Desenvolvimento e testes

Sem dependências de instalação. Requer Node 24.

```sh
npm test
npm run build
```

Para desenvolvimento real, copie `.env.example` para `.env.local`, configure as variáveis e execute `npm run dev`. Esse modo usa o Firebot real.

Para conferir o layout sem cobranças: `npm run demo`. A demonstração é servida apenas em `127.0.0.1:38762`, mostra um aviso explícito e gera um QR de texto que não é um Pix pagável. O modo demonstrativo não existe na função publicada.

## Comportamento

- Validação no navegador e no servidor; prevenção de cliques duplicados.
- Reabrir o modal reutiliza a cobrança atual. Dados ficam somente na memória da página.
- Botão de cópia com alternativa de seleção manual; modal acessível por teclado, Escape e foco contido.
- Sem confirmação automática, webhook, banco de dados ou entrega automática de acesso. A conciliação e a entrega do produto devem ser feitas pelo processo do vendedor.

## Referências e assets

Banner e imagem do produto obtidos do [checkout indicado](https://chk.eduzz.com/60EE7OO803). As marcas de processamento Eduzz, GoDaddy e reCAPTCHA não são exibidas: este checkout utiliza Firebot e não afirma possuir essas integrações.

`public/assets/qrcode.js`: qrcode-generator 1.4.4, de Kazuhiko Arase, licença MIT (arquivo de licença ao lado). Recursos visuais e fonte preservados da referência fornecida.
