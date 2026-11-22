'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const { lerTabela, gravarTabela } = require('./csv');

const ARQ_PRODUTOS = () => path.join(cfg.DATA_DIR, 'produtos.csv');
const ARQ_VENDAS = () => path.join(cfg.DATA_DIR, 'vendas.csv');

const COL_PRODUTOS = ['codigo', 'nome', 'fornecedor', 'estoque', 'preco_compra', 'preco_venda'];
const COL_VENDAS = ['id', 'pedido', 'data', 'codigo', 'produto', 'quantidade', 'preco_unit', 'custo_unit', 'total', 'estoque_restante', 'status'];

class ErroNegocio extends Error {
  constructor(mensagem, status = 400) { super(mensagem); this.status = status; }
}

/* ---------- conversões (valores monetários trabalham em centavos) ---------- */
const centavos = (v) => Math.round(parseFloat(String(v ?? '').replace(',', '.')) * 100) || 0;
const reais = (c) => c / 100;
const dinheiroCsv = (c) => (c / 100).toFixed(2);
// conversão estrita: vazio, nulo, booleano ou lista NÃO viram 0 (Number('') seria 0)
const num = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) ? Number(v) : NaN;
const inteiro = (v) => { const n = num(v); return Number.isInteger(n) ? n : NaN; };

/* ---------- leitura/gravação ---------- */
function lerProdutos() {
  return (lerTabela(ARQ_PRODUTOS()) || [])
    .map((r) => ({
      codigo: parseInt(r.codigo, 10),
      nome: r.nome,
      fornecedor: r.fornecedor,
      estoque: parseInt(r.estoque, 10) || 0,
      compra: centavos(r.preco_compra),
      venda: centavos(r.preco_venda),
    }))
    .filter((p) => Number.isInteger(p.codigo) && p.nome)
    .sort((a, b) => a.codigo - b.codigo);
}

function gravarProdutos(lista) {
  gravarTabela(ARQ_PRODUTOS(), COL_PRODUTOS, lista.map((p) => ({
    codigo: p.codigo, nome: p.nome, fornecedor: p.fornecedor, estoque: p.estoque,
    preco_compra: dinheiroCsv(p.compra), preco_venda: dinheiroCsv(p.venda),
  })));
}

function lerVendas() {
  return (lerTabela(ARQ_VENDAS()) || []).map((r) => ({
    id: parseInt(r.id, 10) || 0,
    pedido: parseInt(r.pedido, 10) || parseInt(r.id, 10) || 0,
    data: r.data || '',
    codigo: parseInt(r.codigo, 10),
    produto: r.produto,
    quantidade: parseInt(r.quantidade, 10) || 0,
    precoUnit: centavos(r.preco_unit),
    custoUnit: centavos(r.custo_unit),
    total: centavos(r.total),
    estoqueRestante: parseInt(r.estoque_restante, 10) || 0,
    status: (r.status || 'concluida').toLowerCase(),
  }));
}

function gravarVendas(lista) {
  gravarTabela(ARQ_VENDAS(), COL_VENDAS, lista.map((v) => ({
    id: v.id, pedido: v.pedido, data: v.data, codigo: v.codigo, produto: v.produto,
    quantidade: v.quantidade, preco_unit: dinheiroCsv(v.precoUnit), custo_unit: dinheiroCsv(v.custoUnit),
    total: dinheiroCsv(v.total), estoque_restante: v.estoqueRestante, status: v.status,
  })));
}

const produtoApi = (p) => ({
  codigo: p.codigo, nome: p.nome, fornecedor: p.fornecedor, estoque: p.estoque,
  precoCompra: reais(p.compra), precoVenda: reais(p.venda), baixo: p.estoque <= cfg.LIMITE_ESTOQUE_BAIXO,
});

const vendaApi = (v) => ({
  id: v.id, pedido: v.pedido, data: v.data, codigo: v.codigo, produto: v.produto,
  quantidade: v.quantidade, precoUnit: reais(v.precoUnit), total: reais(v.total),
  estoqueRestante: v.estoqueRestante, status: v.status,
});

/* ---------- dados iniciais (os mesmos registros do protótipo HTML) ---------- */
function semear() {
  fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
  if (!fs.existsSync(ARQ_PRODUTOS())) {
    const p = (codigo, nome, estoque, compra, venda, fornecedor) =>
      ({ codigo, nome, fornecedor, estoque, compra: compra * 100, venda: venda * 100 });
    gravarProdutos([
      p(1, 'Heineken', 50, 7, 8, 'GrupoHeineken'), p(2, 'Pepsi 2L', 60, 6, 8, 'PepsiEnterprise'),
      p(3, 'Sprite 2L', 56, 6, 7, 'SpriteLTDA'), p(4, 'Brahma 350ml', 67, 4, 5, 'BrahmaCuritiba'),
      p(5, 'Budweiser', 80, 7, 8, 'BudweiserGermany'), p(6, 'Carvão 5kg', 18, 28, 30, 'Carväes Black'),
      p(7, 'Monster', 34, 5, 6, 'MonsterEnergy'), p(8, 'RedBull', 43, 8, 9, "RedBull's"),
      p(9, 'Água Crystal', 12, 4, 5, 'Crystal Mineral'), p(10, 'Coca-Cola 2L', 99, 9, 12, 'Coca do ze'),
      p(11, 'Guaraná 2L', 120, 7, 9, 'Guarana-Piraquara'), p(12, 'Gatorade', 54, 5, 6, 'Gatorade'),
      p(13, 'Doritos', 99, 9, 13, 'DoritosEnterprise'), p(14, 'Vodka', 23, 9, 12, 'VodkaS'),
      p(15, 'RedLabel', 34, 12, 15, 'RedLabel Fornecedor Oficial'), p(16, 'Corona', 12, 6, 7, 'Corona Oficial'),
      p(17, 'Skol', 123, 6, 7, 'Grupo Skol'), p(18, 'Gelo 10kg', 8, 14, 16, 'GeloICE'),
      p(19, 'Fanta Uva', 12, 7, 8, 'FantaRefrigerantes'), p(20, 'Fanta Laranja', 23, 7, 8, 'FantaRefrigerantes'),
    ]);
  }
  if (!fs.existsSync(ARQ_VENDAS())) {
    // Histórico exibido no protótipo. O preço/custo unitário são os valores da época da venda.
    gravarVendas([
      { id: 1, pedido: 1, data: '', codigo: 12, produto: 'Gatorade', quantidade: 1, precoUnit: 700, custoUnit: 600, total: 700, estoqueRestante: 189, status: 'concluida' },
      { id: 2, pedido: 2, data: '', codigo: 13, produto: 'Doritos', quantidade: 1, precoUnit: 1300, custoUnit: 900, total: 1300, estoqueRestante: 99, status: 'concluida' },
    ]);
  }
}

/* ---------- produtos ---------- */
function validarProduto(corpo, criando) {
  const nome = String(corpo.nome ?? '').trim().replace(/\s+/g, ' ');
  const fornecedor = String(corpo.fornecedor ?? '').trim().replace(/\s+/g, ' ');
  if (!nome) throw new ErroNegocio('Informe o nome do produto.');
  if (!fornecedor) throw new ErroNegocio('Informe o fornecedor.');
  if (nome.length > 60) throw new ErroNegocio('O nome pode ter no máximo 60 caracteres.');
  if (fornecedor.length > 60) throw new ErroNegocio('O fornecedor pode ter no máximo 60 caracteres.');
  // evita que o CSV seja interpretado como fórmula ao abrir no Excel
  if (/^[=+\-@]/.test(nome) || /^[=+\-@]/.test(fornecedor)) throw new ErroNegocio('Nome e fornecedor não podem começar com = + - ou @.');
  if (/[\u0000-\u001f]/.test(nome + fornecedor)) throw new ErroNegocio('Há caracteres inválidos no texto informado.');

  // estoque: no cadastro precisa ser > 0; na alteração aceita 0 (produto esgotado após vendas)
  const estoque = inteiro(corpo.estoque);
  const minimo = criando ? 1 : 0;
  if (!(estoque >= minimo) || estoque > 1_000_000) {
    throw new ErroNegocio(criando
      ? 'O estoque inicial deve ser um número inteiro maior que zero.'
      : 'O estoque deve ser um número inteiro maior ou igual a zero.');
  }
  // preços: obrigatórios e estritamente positivos (pelo menos R$ 0,01)
  const compra = Math.round(num(corpo.precoCompra) * 100), venda = Math.round(num(corpo.precoVenda) * 100);
  if (!(compra >= 1) || compra > 100_000_000) throw new ErroNegocio('Informe um preço de compra maior que zero.');
  if (!(venda >= 1) || venda > 100_000_000) throw new ErroNegocio('Informe um preço de venda maior que zero.');
  return { nome, fornecedor, estoque, compra, venda };
}

function criarProduto(corpo) {
  const lista = lerProdutos();
  if (lista.length >= cfg.MAX_PRODUTOS) throw new ErroNegocio(`Limite de ${cfg.MAX_PRODUTOS} produtos atingido.`);
  const dados = validarProduto(corpo, true);
  let codigo;
  if (corpo.codigo === undefined || corpo.codigo === null || corpo.codigo === '') {
    codigo = Math.max(0, ...lista.map((p) => p.codigo)) + 1;
  } else {
    codigo = inteiro(corpo.codigo);
    if (!(codigo >= 1) || codigo > 999_999) throw new ErroNegocio('O código deve ser um número inteiro maior que zero.');
  }
  if (lista.some((p) => p.codigo === codigo)) throw new ErroNegocio(`O código ${codigo} já está cadastrado.`, 409);
  const novo = { codigo, ...dados };
  lista.push(novo);
  gravarProdutos(lista);
  return produtoApi(novo);
}

function alterarProduto(codigo, corpo) {
  const lista = lerProdutos();
  const p = lista.find((x) => x.codigo === codigo);
  if (!p) throw new ErroNegocio('Produto não encontrado.', 404);
  Object.assign(p, validarProduto(corpo, false));
  gravarProdutos(lista);
  return produtoApi(p);
}

function removerProduto(codigo) {
  const lista = lerProdutos();
  if (!lista.some((x) => x.codigo === codigo)) throw new ErroNegocio('Produto não encontrado.', 404);
  gravarProdutos(lista.filter((x) => x.codigo !== codigo)); // o histórico guarda o nome na época da venda
}

/* ---------- vendas ---------- */
function registrarVenda(itens) {
  if (!Array.isArray(itens) || itens.length === 0) throw new ErroNegocio('Adicione ao menos um produto à venda.');
  if (itens.length > 100) throw new ErroNegocio('Itens demais em uma única venda.');

  // junta linhas repetidas do mesmo produto (evita duplicação)
  const pedidos = new Map();
  for (const it of itens) {
    const codigo = inteiro(it?.codigo), qtd = inteiro(it?.quantidade);
    if (!Number.isInteger(codigo)) throw new ErroNegocio('Código de produto inválido.');
    if (!(qtd >= 1) || qtd > 1_000_000) throw new ErroNegocio('A quantidade deve ser um número inteiro maior que zero.');
    pedidos.set(codigo, (pedidos.get(codigo) || 0) + qtd);
  }

  const produtos = lerProdutos();
  const porCodigo = new Map(produtos.map((p) => [p.codigo, p]));
  for (const [codigo, qtd] of pedidos) {  // valida tudo antes de alterar qualquer coisa
    const p = porCodigo.get(codigo);
    if (!p) throw new ErroNegocio(`Produto de código ${codigo} não encontrado.`, 404);
    if (qtd > p.estoque) throw new ErroNegocio(`Estoque insuficiente para ${p.nome}: restam ${p.estoque} un. e a venda pede ${qtd}.`, 409);
  }

  const vendas = lerVendas();
  let proximoId = Math.max(0, ...vendas.map((v) => v.id)) + 1;
  const pedido = Math.max(0, ...vendas.map((v) => v.pedido)) + 1;
  const agora = new Date().toISOString();
  const registros = [];
  for (const [codigo, qtd] of pedidos) {
    const p = porCodigo.get(codigo);
    p.estoque -= qtd;
    registros.push({
      id: proximoId++, pedido, data: agora, codigo, produto: p.nome, quantidade: qtd,
      precoUnit: p.venda, custoUnit: p.compra, total: qtd * p.venda, estoqueRestante: p.estoque, status: 'concluida',
    });
  }
  gravarProdutos(produtos);
  gravarVendas([...vendas, ...registros]);
  return { pedido, total: reais(registros.reduce((s, r) => s + r.total, 0)), itens: registros.map(vendaApi) };
}

/* ---------- painel ---------- */
function painel() {
  const produtos = lerProdutos();
  const todas = lerVendas();
  const validas = todas.filter((v) => v.status !== 'cancelada' && v.status !== 'cancelado'); // canceladas ficam fora

  const faturamento = validas.reduce((s, v) => s + v.total, 0);
  const lucro = validas.reduce((s, v) => s + v.total - v.custoUnit * v.quantidade, 0);

  // ranking: agrupa os registros reais por produto, somando UNIDADES (não pedidos)
  const grupos = new Map();
  for (const v of validas) {
    const g = grupos.get(v.codigo) || { codigo: v.codigo, nome: v.produto, unidades: 0, total: 0 };
    g.unidades += v.quantidade;
    g.total += v.total;
    g.nome = v.produto;
    grupos.set(v.codigo, g);
  }
  const ranking = [...grupos.values()]
    .sort((a, b) => b.unidades - a.unidades || b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, 5)
    .map((g, i) => ({ posicao: i + 1, codigo: g.codigo, nome: g.nome, unidades: g.unidades, total: reais(g.total) }));

  return {
    totalProdutos: produtos.length,
    maxProdutos: cfg.MAX_PRODUTOS,
    itensEmEstoque: produtos.reduce((s, p) => s + p.estoque, 0),
    vendasRegistradas: new Set(validas.map((v) => v.pedido)).size,
    faturamento: reais(faturamento),
    lucro: reais(lucro),
    estoqueBaixo: produtos.filter((p) => p.estoque <= cfg.LIMITE_ESTOQUE_BAIXO).map((p) => ({ codigo: p.codigo, nome: p.nome, estoque: p.estoque })),
    ultimasVendas: validas.slice(-5).reverse().map(vendaApi),
    ranking,
  };
}

module.exports = {
  ErroNegocio, semear, lerProdutos, produtoApi, criarProduto, alterarProduto, removerProduto,
  lerVendas, vendaApi, registrarVenda, painel,
};
