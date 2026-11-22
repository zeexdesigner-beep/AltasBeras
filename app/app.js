'use strict';

/* =========================================================
   Utilitários
   ========================================================= */
const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (v) => brl.format(v).replace(/\u00a0/g, ' ');
const numero = (v) => Number(v).toLocaleString('pt-BR');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** minúsculas e sem acentos, mantendo o mesmo comprimento (permite destacar o trecho encontrado) */
const dobrar = (s) => Array.from(String(s)).map((c) => c.normalize('NFD').replace(/[\u0300-\u036f]/g, '')).join('').toLowerCase();

async function api(metodo, url, corpo) {
  const opcoes = { method: metodo, headers: {} };
  if (corpo !== undefined) { opcoes.headers['Content-Type'] = 'application/json'; opcoes.body = JSON.stringify(corpo); }
  let r;
  try { r = await fetch(url, opcoes); }
  catch { throw new Error('Sem conexão com o servidor.'); }
  if (r.status === 401 && url !== '/api/login') { window.location.replace('/login'); throw new Error('Sessão expirada.'); }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'Erro inesperado.');
  return dados;
}

function mensagem(el, texto, tipo) {
  if (!texto) { el.hidden = true; el.textContent = ''; return; }
  el.textContent = texto;
  el.className = 'msg ' + (tipo || '');
  el.hidden = false;
}

function parsePreco(texto) {
  const t = String(texto ?? '').trim().replace(/^R\$\s*/, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;     // vazio, negativo ou texto → inválido
  return Number(t);
}

/**
 * Valida os campos de um formulário de produto (cadastro ou alteração).
 * Retorna { dados } se tudo estiver certo ou { erro, campo } com a mensagem e o campo a focar.
 */
function validarFormProduto(f, criando) {
  const nome = f.nome.value.trim(), fornecedor = f.fornecedor.value.trim();
  if (!nome) return { erro: 'Informe o nome do produto.', campo: f.nome };
  if (!fornecedor) return { erro: 'Informe o fornecedor.', campo: f.fornecedor };

  if (criando && f.codigo.value.trim() !== '') {
    const c = Number(f.codigo.value);
    if (!Number.isInteger(c) || c < 1) return { erro: 'O código deve ser um número inteiro maior que zero.', campo: f.codigo };
  }

  const estTxt = f.estoque.value.trim(), estoque = Number(estTxt);
  const minimo = criando ? 1 : 0;
  if (estTxt === '' || !Number.isInteger(estoque) || estoque < minimo) {
    return { erro: criando ? 'Informe o estoque inicial (número inteiro maior que zero).' : 'O estoque deve ser um número inteiro maior ou igual a zero.', campo: f.estoque };
  }

  const precoCompra = parsePreco(f.precoCompra.value);
  if (!(precoCompra > 0)) return { erro: 'Informe o preço de compra maior que zero (ex.: 4,50).', campo: f.precoCompra };
  const precoVenda = parsePreco(f.precoVenda.value);
  if (!(precoVenda > 0)) return { erro: 'Informe o preço de venda maior que zero (ex.: 7,90).', campo: f.precoVenda };

  return { dados: { nome, fornecedor, estoque, precoCompra, precoVenda } };
}

/* =========================================================
   Estado
   ========================================================= */
let produtos = [];          // lista atual vinda do servidor
let carrinho = [];          // [{codigo, quantidade}]
let selecionado = null;     // produto exibido no cartão "found"
let sugestoes = [];         // resultados da busca
let sugIndice = -1;

const porCodigo = (c) => produtos.find((p) => p.codigo === c);
const noCarrinho = (c) => carrinho.find((i) => i.codigo === c)?.quantidade || 0;

/* =========================================================
   Carregamento
   ========================================================= */
async function carregarProdutos() {
  produtos = await api('GET', '/api/produtos');
  renderProdutos();
  $('leadProdutos').textContent = `${produtos.length} de 100 produtos cadastrados.`;
  const proximo = Math.max(0, ...produtos.map((p) => p.codigo)) + 1;
  $('novoCodigo').placeholder = String(proximo);
  // remove do carrinho produtos que deixaram de existir; ajusta quantidades acima do estoque
  carrinho = carrinho.filter((i) => porCodigo(i.codigo));
  renderCarrinho();
}

async function carregarPainel() {
  const d = await api('GET', '/api/painel');
  $('pTotal').textContent = d.totalProdutos;
  $('pMax').textContent = d.maxProdutos;
  $('ring').setAttribute('aria-label', `${d.totalProdutos} de ${d.maxProdutos} produtos cadastrados`);
  $('ring').style.setProperty('--pct', Math.min(100, (d.totalProdutos / d.maxProdutos) * 100) + '%');
  $('sItens').textContent = numero(d.itensEmEstoque);
  $('sVendas').textContent = numero(d.vendasRegistradas);
  $('sFat').textContent = dinheiro(d.faturamento);
  $('sLucro').textContent = dinheiro(d.lucro);

  $('listaBaixo').innerHTML = d.estoqueBaixo.length
    ? d.estoqueBaixo.map((p) => `<li><span>${esc(p.nome)}</span><b>${p.estoque} un.</b></li>`).join('')
    : '<li><span class="empty">Nenhum produto com estoque baixo.</span></li>';

  $('listaUltimas').innerHTML = d.ultimasVendas.length
    ? d.ultimasVendas.map((v) => `<li><span>${esc(v.produto)} × ${v.quantidade}</span><b>${dinheiro(v.total)}</b></li>`).join('')
    : '<li><span>Nenhuma venda registrada.</span></li>';

  renderRanking(d.ranking);
}

function renderRanking(ranking) {
  const lista = $('rankLista');
  $('rankVazio').hidden = ranking.length > 0;
  lista.hidden = ranking.length === 0;
  const maximo = Math.max(1, ...ranking.map((r) => r.unidades));
  lista.innerHTML = ranking.map((r) => `
    <li>
      <span class="pos" aria-label="${r.posicao}º lugar">${r.posicao}º</span>
      <div class="rk-main">
        <div class="rk-name" title="${esc(r.nome)}">${esc(r.nome)}</div>
        <div class="track" role="img" aria-label="${r.unidades} unidades vendidas"><i data-w="${(r.unidades / maximo) * 100}"></i></div>
      </div>
      <div class="rk-num"><b>${numero(r.unidades)} un.</b><span>${dinheiro(r.total)}</span></div>
    </li>`).join('');
  // largura aplicada via CSSOM (permite animar e respeita a política de segurança do site)
  requestAnimationFrame(() => lista.querySelectorAll('.track i').forEach((i) => { i.style.width = i.dataset.w + '%'; }));
}

async function carregarHistorico() {
  const vendas = await api('GET', '/api/vendas');
  $('histVazio').hidden = vendas.length > 0;
  $('histLinhas').innerHTML = vendas.map((v) => `
    <div class="item${v.status === 'concluida' ? '' : ' cancelled'}">
      <span>${v.codigo}</span>
      <span>${esc(v.produto)}${v.status === 'concluida' ? '' : '<span class="tag">Cancelada</span>'}</span>
      <span class="n">${v.quantidade}</span>
      <span class="n">${v.estoqueRestante}</span>
      <span class="n tot">${dinheiro(v.total)}</span>
    </div>`).join('');
}

/** Atualiza o que a aba ativa precisa mostrar. */
async function atualizarAba() {
  try {
    mensagem($('erroGlobal'), '');
    const aba = document.querySelector('input.tab:checked').id;
    if (aba === 't1') await carregarPainel();
    else if (aba === 't4') await carregarHistorico();
    else await carregarProdutos();
  } catch (e) { mensagem($('erroGlobal'), e.message, 'err'); }
}

/* =========================================================
   Produtos (tabela, filtro, cadastro, alteração, remoção)
   ========================================================= */
function renderProdutos() {
  const termo = dobrar($('filtroProdutos').value.trim());
  const itens = !termo ? produtos : produtos.filter((p) =>
    String(p.codigo) === termo || String(p.codigo).startsWith(termo) ||
    termo.split(/\s+/).every((t) => dobrar(p.nome + ' ' + p.fornecedor).includes(t)));
  $('tbProdutos').innerHTML = itens.length ? itens.map((p) => `
    <tr>
      <td>${p.codigo}</td>
      <td><b>${esc(p.nome)}</b>${p.baixo ? '<span class="tag">Baixo</span>' : ''}</td>
      <td class="n">${numero(p.estoque)}</td>
      <td class="n">${dinheiro(p.precoCompra)}</td>
      <td class="n">${dinheiro(p.precoVenda)}</td>
      <td>${esc(p.fornecedor)}</td>
      <td><button class="link" data-acao="alterar" data-codigo="${p.codigo}">Alterar</button><button class="link del" data-acao="remover" data-codigo="${p.codigo}">Remover</button></td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">Nenhum produto encontrado.</td></tr>';
}

$('filtroProdutos').addEventListener('input', renderProdutos);

$('formNovo').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target, erro = $('erroNovo');
  mensagem(erro, '');
  const v = validarFormProduto(f, true);
  if (v.erro) { mensagem(erro, v.erro, 'err'); v.campo.focus(); return; }
  try {
    await api('POST', '/api/produtos', { codigo: f.codigo.value.trim() === '' ? null : Number(f.codigo.value), ...v.dados });
    f.reset();
    $('detNovo').open = false;
    await carregarProdutos();
  } catch (e) { mensagem(erro, e.message, 'err'); }
});

/* diálogo de alteração */
let editando = null;
$('tbProdutos').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-acao]');
  if (!b) return;
  const p = porCodigo(Number(b.dataset.codigo));
  if (!p) return;
  if (b.dataset.acao === 'alterar') abrirEdicao(p); else pedirRemocao(p);
});

function abrirEdicao(p) {
  editando = p.codigo;
  const f = $('formEditar');
  $('edCodigoTxt').textContent = `#${p.codigo}`;
  f.nome.value = p.nome; f.fornecedor.value = p.fornecedor; f.estoque.value = p.estoque;
  f.precoCompra.value = p.precoCompra.toFixed(2).replace('.', ',');
  f.precoVenda.value = p.precoVenda.toFixed(2).replace('.', ',');
  mensagem($('erroEditar'), '');
  $('dlgEditar').showModal();
}
$('edCancelar').addEventListener('click', () => $('dlgEditar').close());

$('formEditar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target, erro = $('erroEditar');
  mensagem(erro, '');
  const v = validarFormProduto(f, false);
  if (v.erro) { mensagem(erro, v.erro, 'err'); v.campo.focus(); return; }
  try {
    await api('PUT', `/api/produtos/${editando}`, v.dados);
    $('dlgEditar').close();
    await carregarProdutos();
  } catch (e) { mensagem(erro, e.message, 'err'); }
});

/* diálogo de confirmação de remoção */
let removendo = null;
function pedirRemocao(p) {
  removendo = p.codigo;
  $('cfTitulo').textContent = 'Remover produto?';
  $('cfTexto').textContent = `“${p.nome}” (código ${p.codigo}) será removido do cadastro. O histórico de vendas é mantido.`;
  $('dlgConfirma').showModal();
}
$('cfNao').addEventListener('click', () => $('dlgConfirma').close());
$('cfSim').addEventListener('click', async () => {
  $('dlgConfirma').close();
  try { await api('DELETE', `/api/produtos/${removendo}`); await carregarProdutos(); }
  catch (e) { mensagem($('erroGlobal'), e.message, 'err'); }
});

/* =========================================================
   Nova venda — busca por código e por nome (simultâneas)
   ========================================================= */
const campoBusca = $('busca');
let timerBlur = null;

/** Ordena por relevância: código exato > início do código > início do nome > palavra > contém. */
function buscar(consulta) {
  const q = consulta.trim();
  if (!q) return [];
  const tokens = dobrar(q).split(/\s+/).filter(Boolean);
  const soDigitos = /^\d+$/.test(q);
  const resultados = [];
  for (const p of produtos) {
    const nome = dobrar(p.nome);
    let pontos = null;
    if (soDigitos && p.codigo === Number(q)) pontos = 0;
    else if (soDigitos && String(p.codigo).startsWith(q)) pontos = 1;
    else if (tokens.every((t) => nome.includes(t))) {
      if (nome.startsWith(tokens[0])) pontos = 2;
      else if (nome.split(/[\s\-]+/).some((w) => w.startsWith(tokens[0]))) pontos = 3;
      else pontos = 4;
    }
    if (pontos !== null) resultados.push({ p, pontos, tokens });
  }
  return resultados.sort((a, b) => a.pontos - b.pontos || a.p.nome.localeCompare(b.p.nome, 'pt-BR')).slice(0, 8);
}

function destacar(nome, tokens) {
  const base = dobrar(nome);
  if (base.length !== nome.length) return esc(nome);
  const marcado = new Array(nome.length).fill(false);
  for (const t of tokens) {
    let i = base.indexOf(t);
    while (i !== -1 && t) { for (let k = i; k < i + t.length; k++) marcado[k] = true; i = base.indexOf(t, i + t.length); }
  }
  let saida = '', aberto = false;
  Array.from(nome).forEach((c, i) => {
    if (marcado[i] && !aberto) { saida += '<mark>'; aberto = true; }
    if (!marcado[i] && aberto) { saida += '</mark>'; aberto = false; }
    saida += esc(c);
  });
  return saida + (aberto ? '</mark>' : '');
}

function renderSugestoes() {
  const ul = $('sugestoes');
  const aberto = sugestoes.length > 0;
  ul.hidden = !aberto;
  campoBusca.setAttribute('aria-expanded', String(aberto));
  ul.innerHTML = sugestoes.map(({ p, tokens }, i) => {
    const semEstoque = p.estoque <= 0;
    return `<li role="option" id="sug-${i}" data-codigo="${p.codigo}" aria-selected="${i === sugIndice}" class="${semEstoque ? 'off' : ''}" ${semEstoque ? 'aria-disabled="true"' : ''}>
      <span class="nm">${destacar(p.nome, tokens)}</span>
      <span class="pr">${dinheiro(p.precoVenda)}</span>
      <span class="sub">Cód. ${p.codigo}</span>
      <span class="sub pr">${semEstoque ? 'Sem estoque' : numero(p.estoque) + ' un. disponíveis'}</span>
    </li>`;
  }).join('');
  if (sugIndice >= 0) campoBusca.setAttribute('aria-activedescendant', 'sug-' + sugIndice);
  else campoBusca.removeAttribute('aria-activedescendant');
}

function fecharSugestoes() { sugestoes = []; sugIndice = -1; renderSugestoes(); }

campoBusca.addEventListener('input', () => {
  clearTimeout(timerBlur);
  selecionado = null;
  $('found').hidden = true;
  const q = campoBusca.value;
  if (!q.trim()) { mensagem($('buscaMsg'), ''); fecharSugestoes(); return; }
  sugestoes = buscar(q);
  sugIndice = sugestoes.length ? 0 : -1;
  renderSugestoes();
  // código numérico que não existe: avisa já na digitação, sem esconder eventuais sugestões por nome
  if (/^\d+$/.test(q.trim()) && !porCodigo(Number(q.trim()))) {
    mensagem($('buscaMsg'), `Código ${q.trim()} não encontrado.`, 'err');
  } else if (!sugestoes.length) {
    mensagem($('buscaMsg'), `Nenhum produto encontrado para “${q.trim()}”.`, 'err');
  } else mensagem($('buscaMsg'), '');
});

campoBusca.addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowDown' && sugestoes.length) { ev.preventDefault(); sugIndice = (sugIndice + 1) % sugestoes.length; renderSugestoes(); }
  else if (ev.key === 'ArrowUp' && sugestoes.length) { ev.preventDefault(); sugIndice = (sugIndice - 1 + sugestoes.length) % sugestoes.length; renderSugestoes(); }
  else if (ev.key === 'Escape') fecharSugestoes();
  else if (ev.key === 'Enter') {
    ev.preventDefault();
    const q = campoBusca.value.trim();
    if (!q) return;
    if (/^\d+$/.test(q)) {                               // código digitado: usa o código exato
      const p = porCodigo(Number(q));
      if (p) return selecionarProduto(p);
      return mensagem($('buscaMsg'), `Código ${q} não encontrado.`, 'err');
    }
    if (sugIndice >= 0) return selecionarProduto(sugestoes[sugIndice].p);
    mensagem($('buscaMsg'), `Nenhum produto encontrado para “${q}”.`, 'err');
  }
});

// mousedown (e não click) para funcionar antes do campo perder o foco
$('sugestoes').addEventListener('mousedown', (ev) => {
  const li = ev.target.closest('li[data-codigo]');
  if (!li) return;
  ev.preventDefault();
  const p = porCodigo(Number(li.dataset.codigo));
  if (p) selecionarProduto(p);
});
// fecha a lista ao sair do campo; o atraso permite o clique numa sugestão e é cancelado se o usuário voltar a digitar
campoBusca.addEventListener('blur', () => { timerBlur = setTimeout(fecharSugestoes, 120); });
campoBusca.addEventListener('focus', () => clearTimeout(timerBlur));

function selecionarProduto(p) {
  if (p.estoque <= 0) {
    fecharSugestoes();
    return mensagem($('buscaMsg'), `${p.nome} está sem estoque.`, 'err');
  }
  selecionado = p;
  campoBusca.value = p.nome;
  fecharSugestoes();
  mensagem($('buscaMsg'), '');
  mensagem($('vendaMsg'), '');
  $('fNome').textContent = p.nome;
  $('fCodigo').textContent = p.codigo;
  $('fEstoque').textContent = `${numero(p.estoque)} un.`;
  $('fPreco').textContent = dinheiro(p.precoVenda);
  const jaNoCarrinho = noCarrinho(p.codigo);
  $('fNoCarrinho').hidden = !jaNoCarrinho;
  $('fNoCarrinho').textContent = jaNoCarrinho ? `Já na venda: ${jaNoCarrinho} un. (restam ${p.estoque - jaNoCarrinho} un. para adicionar).` : '';
  $('qtd').value = 1;
  $('qtd').max = p.estoque;
  $('found').hidden = false;
}

/* quantidade */
const lerQtd = () => { const n = Number($('qtd').value); return Number.isInteger(n) && n >= 1 ? n : 1; };
$('qMenos').addEventListener('click', () => { $('qtd').value = Math.max(1, lerQtd() - 1); });
$('qMais').addEventListener('click', () => { $('qtd').value = lerQtd() + 1; });
$('qtd').addEventListener('change', () => { $('qtd').value = lerQtd(); });

/* adicionar ao carrinho (soma no item existente: sem linhas duplicadas) */
$('addVenda').addEventListener('click', () => {
  if (!selecionado) return;
  const p = porCodigo(selecionado.codigo);
  const qtd = lerQtd();
  if (!p) return mensagem($('buscaMsg'), 'Produto não encontrado. Atualize a página.', 'err');
  const total = noCarrinho(p.codigo) + qtd;
  if (total > p.estoque) {
    return mensagem($('buscaMsg'), `Estoque insuficiente: ${p.nome} tem ${p.estoque} un. e a venda teria ${total}.`, 'err');
  }
  const existente = carrinho.find((i) => i.codigo === p.codigo);
  if (existente) existente.quantidade = total; else carrinho.push({ codigo: p.codigo, quantidade: qtd });
  renderCarrinho();
  mensagem($('vendaMsg'), '');
  mensagem($('buscaMsg'), `${p.nome} × ${qtd} adicionado à venda.`, 'ok');
  selecionado = null;
  $('found').hidden = true;
  campoBusca.value = '';
  campoBusca.focus();
});

/* resumo da venda */
function renderCarrinho() {
  let total = 0;
  $('resumoItens').innerHTML = carrinho.map((i) => {
    const p = porCodigo(i.codigo);
    const sub = p.precoVenda * i.quantidade;
    total += sub;
    return `<li class="row">
      <span>${esc(p.nome)} × ${i.quantidade}<small>${p.estoque - i.quantidade >= 0 ? 'estoque após a venda: ' + (p.estoque - i.quantidade) + ' un.' : 'estoque insuficiente (restam ' + p.estoque + ' un.)'}</small></span>
      <b>${dinheiro(sub)}</b>
      <button type="button" class="link del rm" data-codigo="${i.codigo}" aria-label="Remover ${esc(p.nome)} da venda">Remover</button>
    </li>`;
  }).join('');
  $('resumoVazio').hidden = carrinho.length > 0;
  $('resumoTotal').textContent = dinheiro(total);
  $('confirmar').disabled = carrinho.length === 0;
}

$('resumoItens').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-codigo]');
  if (!b) return;
  carrinho = carrinho.filter((i) => i.codigo !== Number(b.dataset.codigo));
  renderCarrinho();
});

$('confirmar').addEventListener('click', async () => {
  if (!carrinho.length) return;
  const botao = $('confirmar');
  botao.disabled = true;
  mensagem($('vendaMsg'), '');
  try {
    const r = await api('POST', '/api/vendas', { itens: carrinho });
    carrinho = [];
    selecionado = null; $('found').hidden = true; campoBusca.value = '';
    mensagem($('buscaMsg'), '');
    await carregarProdutos();                 // estoque atualizado
    mensagem($('vendaMsg'), `Venda registrada: ${dinheiro(r.total)}.`, 'ok');
    carregarPainel().catch(() => {});         // ranking e indicadores já ficam atualizados
  } catch (e) {
    mensagem($('vendaMsg'), e.message, 'err');
    await carregarProdutos().catch(() => {});
    renderCarrinho();
  }
});

/* =========================================================
   Navegação, sessão e inicialização
   ========================================================= */
document.querySelectorAll('input.tab').forEach((t) => t.addEventListener('change', atualizarAba));

async function sair() {
  try { await api('POST', '/api/logout', {}); } catch { /* ignora */ }
  window.location.replace('/login');
}
$('sair').addEventListener('click', sair);
$('sairMobile').addEventListener('click', sair);

(async function iniciar() {
  try {
    const eu = await api('GET', '/api/me');
    $('usuarioAtual').textContent = `Conectado: ${eu.usuario}`;
    await Promise.all([carregarProdutos(), carregarPainel()]);
  } catch (e) { mensagem($('erroGlobal'), e.message, 'err'); }
})();

// ao voltar para a aba do navegador, mantém os números em dia
document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarAba(); });
