'use strict';
// Teste de interface ponta a ponta (opcional; requer Playwright instalado):
//   node tests/e2e-ui.js
// Usa dados temporários e não altera a pasta data/.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'altas-beras-e2e-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'senha-de-teste-123';
process.env.PORT = '0';
const SHOTS = process.env.SHOTS_DIR || null;

let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const { iniciar } = require('../server');

const resultados = [];
const ok = (nome) => { resultados.push(nome); console.log('  ✔', nome); };

(async () => {
  const servidor = await iniciar();
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problemas = [];
  page.on('pageerror', (e) => problemas.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) problemas.push('console: ' + m.text()); });
  // sem internet no teste: as fontes do Google são bloqueadas (a página usa as fontes de reserva)
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const shot = async (nome) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, nome + '.png'), fullPage: true }); };

  /* ---------- acesso sem login ---------- */
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  assert.equal(new URL(page.url()).pathname, '/login');
  ok('acesso a / sem login redireciona para /login');
  await shot('01-login');

  /* ---------- credenciais erradas ---------- */
  await page.fill('#usuario', 'admin');
  await page.fill('#senha', 'senha-errada');
  await page.click('#entrar');
  await page.waitForSelector('#erro:not([hidden])');
  assert.equal((await page.textContent('#erro')).trim(), 'Usuário ou senha incorretos.');
  assert.equal(new URL(page.url()).pathname, '/login');
  ok('credenciais incorretas mostram mensagem de erro e permanecem no login');
  await shot('02-login-erro');

  /* ---------- login correto ---------- */
  await page.fill('#senha', 'senha-de-teste-123');
  await page.click('#entrar');
  await page.waitForURL(base + '/');
  await page.waitForSelector('#rankLista li');
  ok('login correto leva ao painel');

  /* ---------- painel: indicadores e ranking reais ---------- */
  const txt = async (sel) => (await page.textContent(sel)).trim();
  assert.equal(await txt('#sItens'), '1.027');
  assert.equal(await txt('#sVendas'), '2');
  assert.equal(await txt('#sFat'), 'R$ 20,00');
  assert.equal(await txt('#sLucro'), 'R$ 5,00');
  assert.equal(await txt('#pTotal'), '20');
  assert.equal(await page.locator('#listaBaixo li').count(), 4);
  ok('indicadores do painel idênticos ao protótipo (1.027 itens, 2 vendas, R$ 20,00, R$ 5,00)');
  assert.equal(await page.locator('#rankLista li').count(), 2);
  const r1 = await page.locator('#rankLista li').nth(0).innerText();
  assert.match(r1, /1º/); assert.match(r1, /Doritos/); assert.match(r1, /1 un\./); assert.match(r1, /R\$ 13,00/);
  ok('ranking inicial usa o histórico real (Doritos, Gatorade) — sem dados fictícios');
  await page.waitForTimeout(800);
  await shot('03-painel');

  /* ---------- Nova venda: busca por código ---------- */
  await page.click('label[for=t3]');
  await page.fill('#busca', '4');
  await page.waitForSelector('#sugestoes li');
  const primeira = await page.locator('#sugestoes li').first().innerText();
  assert.match(primeira, /Brahma 350ml/); assert.match(primeira, /Cód\. 4/); assert.match(primeira, /R\$ 5,00/); assert.match(primeira, /67 un/);
  ok('digitar código 4 sugere Brahma 350ml com nome, código, preço e estoque');
  await shot('04-sugestoes');
  await page.press('#busca', 'Enter');
  await page.waitForSelector('#found:not([hidden])');
  assert.equal(await txt('#fNome'), 'Brahma 350ml');
  assert.equal(await txt('#fEstoque'), '67 un.');
  assert.equal(await txt('#fPreco'), 'R$ 5,00');
  ok('Enter no código 4 seleciona Brahma 350ml (estoque 67, R$ 5,00)');

  await page.fill('#qtd', '6');
  await page.click('#addVenda');
  assert.match(await txt('#resumoItens'), /Brahma 350ml × 6/);
  assert.equal(await txt('#resumoTotal'), 'R$ 30,00');
  assert.match(await txt('#resumoItens'), /estoque após a venda: 61 un\./);
  ok('Brahma × 6 entra na venda: total R$ 30,00, estoque após 61 un.');

  /* ---------- código inexistente ---------- */
  await page.fill('#busca', '99');
  await page.waitForSelector('#buscaMsg:not([hidden])');
  assert.equal(await txt('#buscaMsg'), 'Código 99 não encontrado.');
  await page.press('#busca', 'Enter');
  assert.equal(await txt('#buscaMsg'), 'Código 99 não encontrado.');
  assert.equal(await page.locator('#found').isHidden(), true);
  ok('código inexistente (99) exibe "Código 99 não encontrado."');

  /* ---------- busca por nome: parcial e sem acento ---------- */
  await page.fill('#busca', 'guar');
  await page.waitForSelector('#sugestoes li');
  assert.match(await page.locator('#sugestoes li').first().innerText(), /Guaraná 2L/);
  ok('busca parcial "guar" encontra Guaraná 2L (sem diferenciar acento)');
  await page.locator('#sugestoes li').first().dispatchEvent('mousedown');
  await page.waitForSelector('#found:not([hidden])');
  assert.equal(await txt('#fNome'), 'Guaraná 2L');
  await page.fill('#qtd', '2');
  await page.click('#addVenda');
  assert.match(await txt('#resumoItens'), /Guaraná 2L × 2/);
  ok('produto escolhido na lista de sugestões é adicionado à venda');

  await page.fill('#busca', 'coca 2');
  await page.waitForSelector('#sugestoes li');
  assert.match(await page.locator('#sugestoes li').first().innerText(), /Coca-Cola 2L/);
  ok('busca com várias palavras ("coca 2") encontra Coca-Cola 2L');

  /* navegação por teclado */
  await page.fill('#busca', 'fanta');
  await page.waitForSelector('#sugestoes li');
  assert.equal(await page.locator('#sugestoes li').count(), 2);
  await page.press('#busca', 'ArrowDown');
  await page.press('#busca', 'Enter');
  await page.waitForSelector('#found:not([hidden])');
  const escolhido = await txt('#fNome');
  assert.ok(['Fanta Uva', 'Fanta Laranja'].includes(escolhido));
  ok('setas + Enter selecionam sugestões pelo teclado');

  /* ---------- sem duplicar: mesmo produto soma na linha existente ---------- */
  await page.fill('#busca', 'brahma');
  await page.waitForSelector('#sugestoes li');
  await page.press('#busca', 'Enter');
  await page.waitForSelector('#found:not([hidden])');
  assert.match(await txt('#fNoCarrinho'), /Já na venda: 6 un/);
  await page.fill('#qtd', '1');
  await page.click('#addVenda');
  assert.equal(await page.locator('#resumoItens li').count(), 2);
  assert.match(await txt('#resumoItens'), /Brahma 350ml × 7/);
  ok('adicionar o mesmo produto de novo soma na mesma linha (sem duplicar): Brahma × 7');

  /* excesso de estoque */
  await page.fill('#busca', '18');
  await page.press('#busca', 'Enter');
  await page.waitForSelector('#found:not([hidden])');
  await page.fill('#qtd', '9');
  await page.click('#addVenda');
  assert.match(await txt('#buscaMsg'), /Estoque insuficiente/);
  assert.equal(await page.locator('#resumoItens li').count(), 2);
  ok('quantidade acima do estoque é recusada com mensagem');

  /* remover item do resumo */
  await page.locator('#resumoItens li', { hasText: 'Guaraná' }).locator('button').click();
  assert.equal(await page.locator('#resumoItens li').count(), 1);
  assert.equal(await txt('#resumoTotal'), 'R$ 35,00');
  ok('remover item do resumo recalcula o total (R$ 35,00)');
  await shot('05-venda');

  /* ---------- confirmar venda ---------- */
  await page.click('#confirmar');
  await page.waitForSelector('#vendaMsg.ok:not([hidden])');
  assert.match(await txt('#vendaMsg'), /Venda registrada: R\$ 35,00/);
  assert.equal(await page.locator('#resumoItens li').count(), 0);
  assert.equal(await page.locator('#confirmar').isDisabled(), true);
  ok('confirmar venda registra R$ 35,00 e esvazia o resumo');

  /* ---------- ranking atualizado ---------- */
  await page.click('label[for=t1]');
  await page.waitForFunction(() => document.querySelector('#rankLista li .rk-name')?.textContent === 'Brahma 350ml');
  const topo = await page.locator('#rankLista li').first().innerText();
  assert.match(topo, /1º/); assert.match(topo, /7 un\./); assert.match(topo, /R\$ 35,00/);
  assert.equal(await page.locator('#rankLista li').count(), 3);
  assert.equal(await txt('#sVendas'), '3');
  assert.equal(await txt('#sFat'), 'R$ 55,00');
  assert.equal(await txt('#sItens'), '1.020');
  ok('ranking atualizado após a venda: 1º Brahma 350ml, 7 un., R$ 35,00; indicadores recalculados');
  await page.waitForTimeout(900);
  const larguras = await page.$$eval('#rankLista .track i', (els) => els.map((e) => parseFloat(e.style.width)));
  assert.equal(larguras[0], 100); assert.ok(larguras[1] < 100 && larguras[1] > 0);
  ok('barras horizontais proporcionais às unidades (100% para o líder)');
  await shot('06-painel-apos-venda');

  /* ---------- histórico ---------- */
  await page.click('label[for=t4]');
  await page.waitForSelector('#histLinhas .item');
  const h0 = await page.locator('#histLinhas .item').first().innerText();
  assert.match(h0, /Brahma 350ml/); assert.match(h0, /\b7\b/); assert.match(h0, /\b60\b/); assert.match(h0, /R\$ 35,00/); // 7 un. vendidas, 67 − 7 = 60 restantes
  assert.equal(await page.locator('#histLinhas .item').count(), 3);
  ok('histórico mostra a nova venda no topo: Brahma, 7 un., estoque restante 60, R$ 35,00');
  await shot('07-historico');

  /* ---------- produtos: filtro, cadastro, edição, remoção ---------- */
  await page.click('label[for=t2]');
  await page.waitForSelector('#tbProdutos tr');
  assert.equal(await page.locator('#tbProdutos tr').count(), 20);
  await page.fill('#filtroProdutos', 'brah');
  assert.equal(await page.locator('#tbProdutos tr').count(), 1);
  await page.fill('#filtroProdutos', '13');
  assert.match(await txt('#tbProdutos'), /Doritos/);
  await page.fill('#filtroProdutos', 'zzz');
  assert.match(await txt('#tbProdutos'), /Nenhum produto encontrado/);
  await page.fill('#filtroProdutos', '');
  ok('filtro da tabela de produtos por nome parcial e por código');

  await page.click('#detNovo summary');
  /* campos obrigatórios e valores inválidos, um a um (a mensagem muda e o foco vai ao campo) */
  const enviar = async () => { await page.click('#formNovo button[type=submit]'); await page.waitForSelector('#erroNovo:not([hidden])'); return txt('#erroNovo'); };
  assert.match(await enviar(), /nome do produto/);
  await page.fill('#formNovo [name=nome]', 'Duplicado');
  assert.match(await enviar(), /fornecedor/);
  await page.fill('#formNovo [name=fornecedor]', 'Forn X');
  assert.match(await enviar(), /estoque inicial/);
  await page.fill('#formNovo [name=estoque]', '0');
  assert.match(await enviar(), /estoque inicial.*maior que zero/);
  await page.fill('#formNovo [name=estoque]', '-4');
  assert.match(await enviar(), /estoque inicial/);
  await page.fill('#formNovo [name=estoque]', '30');
  assert.match(await enviar(), /preço de compra/);
  await page.fill('#formNovo [name=precoCompra]', '0');
  assert.match(await enviar(), /preço de compra maior que zero/);
  await page.fill('#formNovo [name=precoCompra]', '-2,50');
  assert.match(await enviar(), /preço de compra maior que zero/);
  await page.fill('#formNovo [name=precoCompra]', '4,50');
  assert.match(await enviar(), /preço de venda/);
  await page.fill('#formNovo [name=precoVenda]', '0,00');
  assert.match(await enviar(), /preço de venda maior que zero/);
  assert.equal(await page.locator('#tbProdutos tr').count(), 20);  // nada foi cadastrado
  ok('formulário recusa campos vazios, zero e negativos (nome, fornecedor, estoque, preços) com mensagem específica');

  await page.fill('#formNovo [name=precoVenda]', '7,90');
  await page.fill('#formNovo [name=codigo]', '0');
  assert.match(await enviar(), /código.*maior que zero/);
  await page.fill('#formNovo [name=codigo]', '4');
  assert.match(await enviar(), /código 4 já está cadastrado/);
  ok('código 0 é recusado e código repetido é recusado');
  await page.fill('#formNovo [name=codigo]', '');
  await page.fill('#formNovo [name=nome]', 'Suco de Uva 1L');
  await page.fill('#formNovo [name=fornecedor]', 'Del Valle');
  await page.fill('#formNovo [name=estoque]', '30');
  await page.fill('#formNovo [name=precoCompra]', '4,50');
  await page.fill('#formNovo [name=precoVenda]', '7,90');
  await page.click('#formNovo button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('#tbProdutos tr').length === 21);
  assert.match(await txt('#leadProdutos'), /21 de 100/);
  ok('cadastrar produto novo (código automático 21) — aparece na tabela');

  await page.click('#tbProdutos tr:has-text("Suco de Uva") [data-acao=alterar]');
  await page.fill('#formEditar [name=precoVenda]', '0');
  await page.click('#formEditar button[type=submit]');
  await page.waitForSelector('#erroEditar:not([hidden])');
  assert.match(await txt('#erroEditar'), /preço de venda maior que zero/);
  await page.fill('#formEditar [name=fornecedor]', '  ');
  await page.click('#formEditar button[type=submit]');
  assert.match(await txt('#erroEditar'), /fornecedor/);
  ok('alteração recusa preço zero e fornecedor vazio');
  await page.fill('#formEditar [name=fornecedor]', 'Del Valle');
  await page.fill('#formEditar [name=estoque]', '10');
  await page.fill('#formEditar [name=precoVenda]', '8,50');
  await page.click('#formEditar button[type=submit]');
  await page.waitForFunction(() => /R\$ 8,50/.test(document.querySelector('#tbProdutos').textContent));
  assert.match(await txt('#tbProdutos'), /Suco de Uva 1L\s*Baixo/);
  ok('alterar produto atualiza preço e marca estoque baixo');

  await page.click('#tbProdutos tr:has-text("Suco de Uva") [data-acao=remover]');
  await page.click('#cfSim');
  await page.waitForFunction(() => document.querySelectorAll('#tbProdutos tr').length === 20);
  ok('remover produto (com confirmação) funciona');
  await shot('08-produtos');

  /* a busca da venda enxerga o produto cadastrado */
  await page.click('label[for=t3]');
  await page.fill('#busca', 'suco');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#sugestoes li').count(), 0);
  ok('produto removido deixa de aparecer na busca da venda');

  /* ---------- logout ---------- */
  await page.click('#sair');
  await page.waitForURL(base + '/login');
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  assert.equal(new URL(page.url()).pathname, '/login');
  const apos = await page.evaluate(() => fetch('/api/produtos').then((r) => r.status));
  assert.equal(apos, 401);
  ok('logout encerra a sessão: / volta ao login e a API responde 401');
  await page.goBack().catch(() => {});

  /* ---------- sem erros de JS / CSP ---------- */
  assert.deepEqual(problemas, []);
  ok('nenhum erro de JavaScript ou violação de CSP no console');

  /* ---------- mobile ---------- */
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mobile.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const mp = await mobile.newPage();
  await mp.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  if (SHOTS) await mp.screenshot({ path: path.join(SHOTS, '09-login-mobile.png'), fullPage: true });
  await mp.fill('#usuario', 'admin'); await mp.fill('#senha', 'senha-de-teste-123'); await mp.click('#entrar');
  await mp.waitForURL(base + '/'); await mp.waitForSelector('#rankLista li');
  await mp.waitForTimeout(900);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false);
  assert.equal(await mp.locator('#sairMobile').isVisible(), true);
  if (SHOTS) await mp.screenshot({ path: path.join(SHOTS, '10-painel-mobile.png'), fullPage: true });
  ok('layout mobile sem rolagem horizontal e com botão Sair visível');

  await browser.close();
  servidor.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${resultados.length} verificações de interface concluídas sem falhas.`);
})().catch((e) => { console.error('\nFALHA:', e.message); process.exit(1); });
