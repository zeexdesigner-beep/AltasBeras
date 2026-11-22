'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./lib/config');
const auth = require('./lib/auth');
const dados = require('./lib/dados');

const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };

// Arquivos servidos. Nada fora desta lista é acessível (sem path traversal e sem expor data/).
const PUBLICOS = {
  '/style.css': 'public/style.css',
  '/logo.png': 'public/logo.png',
  '/login.js': 'public/login.js',
};
const PROTEGIDOS = { '/app.js': 'app/app.js' }; // só com sessão válida

const CSP = [
  "default-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "script-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

function cabecalhosBase(extra = {}) {
  return {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  };
}

const lerCookie = (req, nome) => {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(nome + '='));
  return m ? decodeURIComponent(m.slice(nome.length + 1)) : null;
};

const ehHttps = (req) => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';

function cookieSessao(req, token, maxAge) {
  return `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${ehHttps(req) ? '; Secure' : ''}`;
}

function json(res, status, corpo, extra = {}) {
  res.writeHead(status, cabecalhosBase({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }));
  res.end(JSON.stringify(corpo));
}

function redirecionar(res, destino) {
  res.writeHead(302, cabecalhosBase({ Location: destino, 'Cache-Control': 'no-store' }));
  res.end();
}

function enviarArquivo(res, relativo, privado) {
  const arquivo = path.join(cfg.RAIZ, relativo);
  fs.readFile(arquivo, (err, conteudo) => {
    if (err) return json(res, 404, { erro: 'Não encontrado.' });
    res.writeHead(200, cabecalhosBase({
      'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream',
      'Cache-Control': privado ? 'no-store' : 'no-cache',
    }));
    res.end(conteudo);
  });
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = []; let tam = 0;
    req.on('data', (c) => {
      tam += c.length;
      if (tam > 20_000) { reject(new dados.ErroNegocio('Requisição grande demais.', 413)); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      if (!partes.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); }
      catch { reject(new dados.ErroNegocio('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

async function api(req, res, rota, sessao) {
  const metodo = req.method;
  const alteraDados = metodo !== 'GET' && metodo !== 'HEAD';

  if (alteraDados) {
    // proteção contra CSRF: cookie SameSite=Strict + conferência de origem + corpo JSON obrigatório
    const origem = req.headers.origin;
    if (origem) {
      let host = null;
      try { host = new URL(origem).host; } catch { /* inválida */ }
      if (host !== req.headers.host) return json(res, 403, { erro: 'Origem não permitida.' });
    }
    // POST/PUT carregam corpo e precisam ser JSON (DELETE não tem corpo)
    if ((metodo === 'POST' || metodo === 'PUT') && !(req.headers['content-type'] || '').startsWith('application/json')) {
      return json(res, 415, { erro: 'Content-Type deve ser application/json.' });
    }
  }

  /* ----- login / logout (únicas rotas que não exigem sessão) ----- */
  if (rota === '/api/login' && metodo === 'POST') {
    const ip = req.socket.remoteAddress || 'desconhecido';
    const espera = auth.bloqueioRestante(ip);
    if (espera > 0) {
      return json(res, 429, { erro: `Muitas tentativas. Aguarde ${Math.ceil(espera / 60000)} min e tente novamente.` }, { 'Retry-After': String(Math.ceil(espera / 1000)) });
    }
    const corpo = await lerCorpo(req);
    const usuario = await auth.autenticar(corpo.usuario, corpo.senha);
    if (!usuario) {
      auth.registrarFalha(ip);
      return json(res, 401, { erro: 'Usuário ou senha incorretos.' });
    }
    auth.limparFalhas(ip);
    const antigo = lerCookie(req, 'sid');
    if (antigo) auth.encerrarSessao(antigo); // nova sessão a cada login
    const token = auth.criarSessao(usuario);
    return json(res, 200, { ok: true, usuario }, { 'Set-Cookie': cookieSessao(req, token, cfg.SESSAO_TTL_MS / 1000) });
  }

  if (rota === '/api/logout' && metodo === 'POST') {
    const token = lerCookie(req, 'sid');
    if (token) auth.encerrarSessao(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, '', 0) });
  }

  /* ----- daqui em diante tudo exige autenticação ----- */
  if (!sessao) return json(res, 401, { erro: 'Sessão expirada. Faça login novamente.' });

  if (rota === '/api/me' && metodo === 'GET') return json(res, 200, { usuario: sessao.usuario });
  if (rota === '/api/painel' && metodo === 'GET') return json(res, 200, dados.painel());
  if (rota === '/api/vendas' && metodo === 'GET') return json(res, 200, dados.lerVendas().reverse().map(dados.vendaApi));
  if (rota === '/api/vendas' && metodo === 'POST') {
    const corpo = await lerCorpo(req);
    return json(res, 201, dados.registrarVenda(corpo.itens));
  }

  if (rota === '/api/produtos' && metodo === 'GET') return json(res, 200, dados.lerProdutos().map(dados.produtoApi));
  if (rota === '/api/produtos' && metodo === 'POST') {
    return json(res, 201, dados.criarProduto(await lerCorpo(req)));
  }
  const m = rota.match(/^\/api\/produtos\/(\d+)$/);
  if (m) {
    const codigo = parseInt(m[1], 10);
    if (metodo === 'PUT') return json(res, 200, dados.alterarProduto(codigo, await lerCorpo(req)));
    if (metodo === 'DELETE') { dados.removerProduto(codigo); return json(res, 200, { ok: true }); }
  }

  return json(res, 404, { erro: 'Rota não encontrada.' });
}

async function tratar(req, res) {
  const rota = new URL(req.url, 'http://localhost').pathname;
  const sessao = auth.sessaoDe(lerCookie(req, 'sid'));

  if (rota.startsWith('/api/')) return api(req, res, rota, sessao);

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { erro: 'Método não permitido.' });

  if (rota === '/login') return sessao ? redirecionar(res, '/') : enviarArquivo(res, 'public/login.html', true);
  if (rota === '/' || rota === '/index.html') return sessao ? enviarArquivo(res, 'app/index.html', true) : redirecionar(res, '/login');
  if (PROTEGIDOS[rota]) return sessao ? enviarArquivo(res, PROTEGIDOS[rota], true) : redirecionar(res, '/login');
  if (PUBLICOS[rota]) return enviarArquivo(res, PUBLICOS[rota], false);

  // qualquer outra página: sem sessão vai para o login; com sessão, 404
  return sessao ? json(res, 404, { erro: 'Página não encontrada.' }) : redirecionar(res, '/login');
}

function criarServidor() {
  return http.createServer((req, res) => {
    tratar(req, res).catch((e) => {
      if (e instanceof dados.ErroNegocio) return json(res, e.status, { erro: e.message });
      console.error(e);
      if (!res.headersSent) json(res, 500, { erro: 'Erro interno do servidor.' });
    });
  });
}

async function iniciar() {
  dados.semear();
  const admin = await auth.garantirAdmin();
  const servidor = criarServidor();
  await new Promise((ok) => servidor.listen(cfg.PORT, cfg.HOST, ok));
  const porta = servidor.address().port;
  console.log(`\n  Altas Beras rodando em http://${cfg.HOST === '0.0.0.0' ? 'localhost' : cfg.HOST}:${porta}`);
  if (admin) {
    console.log('\n  Conta de administrador criada (esta é a única vez que a senha aparece):');
    console.log(`    usuário: ${admin.usuario}`);
    console.log(admin.senha ? `    senha:   ${admin.senha}` : '    senha:   (definida em ADMIN_PASSWORD)');
    console.log('  Para trocar a senha: npm run admin -- <usuario> <nova-senha>\n');
  }
  return servidor;
}

if (require.main === module) iniciar().catch((e) => { console.error(e); process.exit(1); });

module.exports = { iniciar, criarServidor };
