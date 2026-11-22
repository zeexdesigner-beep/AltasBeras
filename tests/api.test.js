'use strict';
// Executar com: npm test   (usa uma pasta de dados temporária; não toca em data/)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'altas-beras-test-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'senha-de-teste-123';

const { iniciar } = require('../server');
const auth = require('../lib/auth');

let base, servidor;
let cookie = '';

async function req(metodo, url, corpo, { semCookie = false, headers = {} } = {}) {
  const h = { ...headers };
  if (corpo !== undefined) h['Content-Type'] = 'application/json';
  if (cookie && !semCookie) h.Cookie = cookie;
  const r = await fetch(base + url, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo), redirect: 'manual' });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch { /* html */ }
  return { status: r.status, json, texto, headers: r.headers };
}

test.before(async () => {
  process.env.PORT = '0';
  servidor = await iniciar();
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => { servidor.close(); fs.rmSync(dir, { recursive: true, force: true }); });

/* ---------------- LOGIN / SESSÃO ---------------- */
test('páginas e API exigem autenticação', async () => {
  const home = await req('GET', '/');
  assert.equal(home.status, 302); assert.equal(home.headers.get('location'), '/login');
  const js = await req('GET', '/app.js');
  assert.equal(js.status, 302);
  for (const rota of ['/api/produtos', '/api/vendas', '/api/painel', '/api/me']) {
    assert.equal((await req('GET', rota)).status, 401, rota);
  }
  assert.equal((await req('POST', '/api/vendas', { itens: [{ codigo: 1, quantidade: 1 }] })).status, 401);
  assert.equal((await req('DELETE', '/api/produtos/1')).status, 401);
});

test('página de login é pública e arquivos de dados não são expostos', async () => {
  const login = await req('GET', '/login');
  assert.equal(login.status, 200); assert.match(login.texto, /Entrar/);
  for (const caminho of ['/data/usuarios.json', '/data/produtos.csv', '/server.js', '/lib/auth.js', '/../data/usuarios.json', '/%2e%2e/server.js']) {
    const r = await req('GET', caminho);
    assert.notEqual(r.status, 200, caminho);
    assert.ok(!/scrypt\$|codigo;nome/.test(r.texto), caminho);
  }
});

test('senha armazenada somente como hash scrypt', () => {
  const bruto = fs.readFileSync(path.join(dir, 'usuarios.json'), 'utf8');
  assert.ok(!bruto.includes('senha-de-teste-123'));
  assert.match(JSON.parse(bruto)[0].hash, /^scrypt\$16384\$8\$1\$/);
});

test('credenciais incorretas retornam erro e não criam sessão', async () => {
  const r = await req('POST', '/api/login', { usuario: 'admin', senha: 'errada' });
  assert.equal(r.status, 401);
  assert.equal(r.json.erro, 'Usuário ou senha incorretos.');
  assert.equal(r.headers.get('set-cookie'), null);
  const r2 = await req('POST', '/api/login', { usuario: 'naoexiste', senha: 'qualquer' });
  assert.equal(r2.status, 401);
  assert.equal(r2.json.erro, r.json.erro); // mesma mensagem: não revela se o usuário existe
});

test('login correto cria sessão com cookie HttpOnly/SameSite e libera as páginas', async () => {
  const r = await req('POST', '/api/login', { usuario: 'Admin', senha: 'senha-de-teste-123' });
  assert.equal(r.status, 200);
  const set = r.headers.get('set-cookie');
  assert.match(set, /HttpOnly/); assert.match(set, /SameSite=Strict/);
  cookie = set.split(';')[0];
  assert.equal((await req('GET', '/')).status, 200);
  assert.equal((await req('GET', '/app.js')).status, 200);
  assert.equal((await req('GET', '/api/me')).json.usuario, 'admin');
  assert.equal((await req('GET', '/login')).status, 302); // já logado → vai ao sistema
});

test('POST de outra origem é bloqueado (CSRF)', async () => {
  const r = await req('POST', '/api/vendas', { itens: [{ codigo: 1, quantidade: 1 }] }, { headers: { Origin: 'http://site-malicioso.example' } });
  assert.equal(r.status, 403);
});

/* ---------------- PRODUTOS ---------------- */
test('lista produtos existentes (20 cadastrados no protótipo)', async () => {
  const r = await req('GET', '/api/produtos');
  assert.equal(r.json.length, 20);
  const brahma = r.json.find((p) => p.codigo === 4);
  assert.deepEqual([brahma.nome, brahma.estoque, brahma.precoVenda], ['Brahma 350ml', 67, 5]);
});

test('cadastro valida código repetido, valores negativos e nome vazio', async () => {
  const novo = { codigo: 21, nome: 'Teste Cola', fornecedor: 'Forn', estoque: 10, precoCompra: 2, precoVenda: 3.5 };
  assert.equal((await req('POST', '/api/produtos', { ...novo, codigo: 4 })).status, 409);
  assert.equal((await req('POST', '/api/produtos', { ...novo, precoVenda: -1 })).status, 400);
  assert.equal((await req('POST', '/api/produtos', { ...novo, estoque: -5 })).status, 400);
  assert.equal((await req('POST', '/api/produtos', { ...novo, nome: '  ' })).status, 400);
  assert.equal((await req('POST', '/api/produtos', { ...novo, nome: '=CMD()' })).status, 400);
  const ok = await req('POST', '/api/produtos', novo);
  assert.equal(ok.status, 201); assert.equal(ok.json.codigo, 21);
  const auto = await req('POST', '/api/produtos', { ...novo, codigo: null, nome: 'Auto Código' });
  assert.equal(auto.json.codigo, 22);
});

test('cadastro recusa zero, negativos, vazios e campos obrigatórios ausentes', async () => {
  const base = { codigo: 60, nome: 'Validação', fornecedor: 'Forn', estoque: 5, precoCompra: 2, precoVenda: 3 };
  const recusa = async (alteracao, trecho) => {
    const r = await req('POST', '/api/produtos', { ...base, ...alteracao });
    assert.equal(r.status, 400, JSON.stringify(alteracao));
    assert.match(r.json.erro, trecho, JSON.stringify(alteracao));
  };
  await recusa({ fornecedor: '' }, /fornecedor/i);
  await recusa({ fornecedor: '   ' }, /fornecedor/i);
  await recusa({ fornecedor: undefined }, /fornecedor/i);
  await recusa({ nome: '' }, /nome/i);
  await recusa({ estoque: 0 }, /estoque inicial.*maior que zero/i);
  await recusa({ estoque: '' }, /estoque/i);          // vazio não pode virar 0
  await recusa({ estoque: null }, /estoque/i);
  await recusa({ estoque: -1 }, /estoque/i);
  await recusa({ estoque: 1.5 }, /estoque/i);
  await recusa({ precoCompra: 0 }, /preço de compra/i);
  await recusa({ precoCompra: -2 }, /preço de compra/i);
  await recusa({ precoCompra: '' }, /preço de compra/i);
  await recusa({ precoCompra: 0.004 }, /preço de compra/i); // arredonda para R$ 0,00
  await recusa({ precoVenda: 0 }, /preço de venda/i);
  await recusa({ precoVenda: -0.01 }, /preço de venda/i);
  await recusa({ precoVenda: undefined }, /preço de venda/i);
  await recusa({ precoVenda: true }, /preço de venda/i);
  await recusa({ codigo: 0 }, /código.*maior que zero/i);
  await recusa({ codigo: -3 }, /código/i);
  assert.equal((await req('GET', '/api/produtos')).json.some((p) => p.codigo === 60), false); // nada foi gravado
  const ok = await req('POST', '/api/produtos', { ...base, precoCompra: 0.01, estoque: 1 });
  assert.equal(ok.status, 201);                       // limites mínimos válidos
  await req('DELETE', '/api/produtos/60');
});

test('alteração: preços e campos obrigatórios; estoque 0 permitido (esgotado)', async () => {
  const dados = { nome: 'Teste Cola 2', fornecedor: 'X', estoque: 11, precoCompra: 2, precoVenda: 4 };
  for (const alt of [{ precoVenda: 0 }, { precoCompra: -1 }, { fornecedor: ' ' }, { nome: '' }, { estoque: -1 }, { estoque: '' }]) {
    assert.equal((await req('PUT', '/api/produtos/21', { ...dados, ...alt })).status, 400, JSON.stringify(alt));
  }
  assert.equal((await req('GET', '/api/produtos')).json.find((p) => p.codigo === 21).precoVenda, 3.5); // intacto
  assert.equal((await req('PUT', '/api/produtos/21', { ...dados, estoque: 0 })).status, 200);
  await req('PUT', '/api/produtos/21', dados); // volta ao estado usado pelos testes seguintes
});

test('alterar e remover produto', async () => {
  const alt = await req('PUT', '/api/produtos/21', { nome: 'Teste Cola 2', fornecedor: 'X', estoque: 11, precoCompra: 2, precoVenda: 4 });
  assert.equal(alt.json.nome, 'Teste Cola 2'); assert.equal(alt.json.estoque, 11);
  assert.equal((await req('PUT', '/api/produtos/999', { nome: 'a', estoque: 1, precoCompra: 1, precoVenda: 1 })).status, 404);
  assert.equal((await req('DELETE', '/api/produtos/22')).status, 200);
  assert.equal((await req('DELETE', '/api/produtos/22')).status, 404);
});

/* ---------------- PAINEL: estado inicial ---------------- */
test('painel inicial reproduz os indicadores do protótipo', async () => {
  const d = (await req('GET', '/api/painel')).json;
  assert.equal(d.vendasRegistradas, 2);
  assert.equal(d.faturamento, 20);
  assert.equal(d.lucro, 5);
  assert.deepEqual(d.estoqueBaixo.map((p) => p.nome).slice(0, 4), ['Água Crystal', 'Corona', 'Gelo 10kg', 'Fanta Uva']); // + produtos de teste cadastrados acima
  assert.deepEqual(d.ranking.map((r) => [r.posicao, r.nome, r.unidades, r.total]), [[1, 'Doritos', 1, 13], [2, 'Gatorade', 1, 7]]);
});

/* ---------------- VENDAS ---------------- */
test('venda: valida entrada e estoque sem alterar nada em caso de erro', async () => {
  const antes = (await req('GET', '/api/produtos')).json.find((p) => p.codigo === 4).estoque;
  assert.equal((await req('POST', '/api/vendas', { itens: [] })).status, 400);
  assert.equal((await req('POST', '/api/vendas', { itens: [{ codigo: 4, quantidade: 0 }] })).status, 400);
  assert.equal((await req('POST', '/api/vendas', { itens: [{ codigo: 4, quantidade: 1.5 }] })).status, 400);
  assert.equal((await req('POST', '/api/vendas', { itens: [{ codigo: 4, quantidade: -2 }] })).status, 400);
  assert.equal((await req('POST', '/api/vendas', { itens: [{ codigo: 12345, quantidade: 1 }] })).status, 404);
  // segunda linha excede o estoque → a venda inteira é recusada
  const r = await req('POST', '/api/vendas', { itens: [{ codigo: 4, quantidade: 1 }, { codigo: 18, quantidade: 9 }] });
  assert.equal(r.status, 409); assert.match(r.json.erro, /Estoque insuficiente/);
  const depois = (await req('GET', '/api/produtos')).json.find((p) => p.codigo === 4).estoque;
  assert.equal(depois, antes);
});

test('venda de 6 Brahma: baixa estoque, grava histórico e atualiza o ranking', async () => {
  const r = await req('POST', '/api/vendas', { itens: [{ codigo: 4, quantidade: 6 }] });
  assert.equal(r.status, 201); assert.equal(r.json.total, 30);
  assert.equal(r.json.itens[0].estoqueRestante, 61);
  assert.equal((await req('GET', '/api/produtos')).json.find((p) => p.codigo === 4).estoque, 61);
  const hist = (await req('GET', '/api/vendas')).json;
  assert.equal(hist.length, 3); assert.equal(hist[0].produto, 'Brahma 350ml'); // mais recente primeiro
  const d = (await req('GET', '/api/painel')).json;
  assert.deepEqual(d.ranking[0], { posicao: 1, codigo: 4, nome: 'Brahma 350ml', unidades: 6, total: 30 });
  assert.equal(d.vendasRegistradas, 3); assert.equal(d.faturamento, 50);
});

test('ranking soma UNIDADES (não pedidos), junta linhas repetidas e limita a 5', async () => {
  // Pepsi: 1 pedido com 20 unidades (junta duas linhas do mesmo produto)
  await req('POST', '/api/vendas', { itens: [{ codigo: 2, quantidade: 8 }, { codigo: 2, quantidade: 12 }] });
  // Sprite: 3 pedidos de 1 unidade (3 un.)
  for (let i = 0; i < 3; i++) await req('POST', '/api/vendas', { itens: [{ codigo: 3, quantidade: 1 }] });
  for (const c of [5, 7, 8]) await req('POST', '/api/vendas', { itens: [{ codigo: c, quantidade: 2 }] });
  const d = (await req('GET', '/api/painel')).json;
  assert.equal(d.ranking.length, 5);
  assert.deepEqual(d.ranking.map((r) => r.nome).slice(0, 2), ['Pepsi 2L', 'Brahma 350ml']);
  assert.equal(d.ranking[0].unidades, 20);
  const sprite = d.ranking.find((r) => r.nome === 'Sprite 2L');
  assert.equal(sprite.unidades, 3);
  assert.deepEqual(d.ranking.map((r) => r.posicao), [1, 2, 3, 4, 5]);
  // histórico: a venda com duas linhas de Pepsi virou 1 registro de 20 un.
  const hist = (await req('GET', '/api/vendas')).json.filter((h) => h.codigo === 2);
  assert.equal(hist.length, 1); assert.equal(hist[0].quantidade, 20);
});

test('vendas canceladas não entram no ranking nem nos totais', async () => {
  const arq = path.join(dir, 'vendas.csv');
  const antes = (await req('GET', '/api/painel')).json;
  fs.appendFileSync(arq, '900;900;;17;Skol;500;7.00;6.00;3500.00;0;cancelada\r\n');
  const d = (await req('GET', '/api/painel')).json;
  assert.ok(!d.ranking.some((r) => r.nome === 'Skol'));
  assert.equal(d.faturamento, antes.faturamento);
  assert.equal(d.vendasRegistradas, antes.vendasRegistradas);
});

test('painel sem vendas devolve ranking vazio (sem dados fictícios)', async () => {
  fs.writeFileSync(path.join(dir, 'vendas.csv'), 'id;pedido;data;codigo;produto;quantidade;preco_unit;custo_unit;total;estoque_restante;status\r\n');
  const d = (await req('GET', '/api/painel')).json;
  assert.deepEqual(d.ranking, []); assert.equal(d.vendasRegistradas, 0); assert.equal(d.faturamento, 0);
});

test('CSV com vírgula e aspas no nome é preservado', async () => {
  const r = await req('POST', '/api/produtos', { codigo: 50, nome: 'Água "Gás", 500ml', fornecedor: 'A;B', estoque: 3, precoCompra: 1, precoVenda: 2 });
  assert.equal(r.status, 201);
  const p = (await req('GET', '/api/produtos')).json.find((x) => x.codigo === 50);
  assert.equal(p.nome, 'Água "Gás", 500ml'); assert.equal(p.fornecedor, 'A;B');
});

/* ---------------- LOGOUT ---------------- */
test('logout encerra a sessão no servidor', async () => {
  const antigo = cookie;
  const r = await req('POST', '/api/logout', {});
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  // mesmo reutilizando o cookie antigo, o acesso é negado
  cookie = antigo;
  assert.equal((await req('GET', '/api/produtos')).status, 401);
  assert.equal((await req('GET', '/')).status, 302);
  cookie = '';
});

test('login: bloqueio após muitas tentativas erradas', async () => {
  let ultimo;
  for (let i = 0; i < 6; i++) ultimo = await req('POST', '/api/login', { usuario: 'admin', senha: 'x' + i });
  assert.equal(ultimo.status, 429);
  // com bloqueio ativo, nem a senha correta passa
  assert.equal((await req('POST', '/api/login', { usuario: 'admin', senha: 'senha-de-teste-123' })).status, 429);
});

test('verificarSenha aceita a correta e rejeita a errada', async () => {
  const h = await auth.hashSenha('abc12345');
  assert.equal(await auth.verificarSenha('abc12345', h), true);
  assert.equal(await auth.verificarSenha('abc12346', h), false);
});
