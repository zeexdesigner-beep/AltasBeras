'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const cfg = require('./config');

const scrypt = promisify(crypto.scrypt);
const ARQ_USUARIOS = () => path.join(cfg.DATA_DIR, 'usuarios.json');

// Parâmetros do scrypt (padrão recomendado: N=2^14, r=8, p=1)
const N = 16384, R = 8, P = 1, TAM = 64;

/* ---------- senhas ---------- */
async function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = await scrypt(senha, sal, TAM, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${h.toString('base64')}`;
}

async function verificarSenha(senha, armazenado) {
  try {
    const [alg, n, r, p, sal, hash] = String(armazenado).split('$');
    if (alg !== 'scrypt') return false;
    const esperado = Buffer.from(hash, 'base64');
    const h = await scrypt(senha, Buffer.from(sal, 'base64'), esperado.length, { N: +n, r: +r, p: +p });
    return crypto.timingSafeEqual(h, esperado);
  } catch { return false; }
}

/* ---------- usuários (data/usuarios.json guarda apenas o hash) ---------- */
function lerUsuarios() {
  try { return JSON.parse(fs.readFileSync(ARQ_USUARIOS(), 'utf8')); } catch { return []; }
}

function gravarUsuarios(lista) {
  fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
  const tmp = ARQ_USUARIOS() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, ARQ_USUARIOS());
}

function validarSenhaForte(senha) {
  if (typeof senha !== 'string' || senha.length < 8) throw new Error('A senha deve ter pelo menos 8 caracteres.');
  if (senha.length > 200) throw new Error('A senha é longa demais.');
}

/** Cria ou redefine um usuário administrador. */
async function definirUsuario(usuario, senha) {
  usuario = String(usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('Usuário inválido: use 3 a 30 letras minúsculas, números, ponto, hífen ou sublinhado.');
  validarSenhaForte(senha);
  const lista = lerUsuarios().filter((u) => u.usuario !== usuario);
  lista.push({ usuario, hash: await hashSenha(senha), criadoEm: new Date().toISOString() });
  gravarUsuarios(lista);
  return usuario;
}

/**
 * Garante a conta inicial. Não há cadastro público: se nenhum usuário existir,
 * cria "admin" com ADMIN_PASSWORD (se definida) ou com uma senha aleatória exibida uma única vez.
 */
async function garantirAdmin() {
  if (lerUsuarios().length > 0) return null;
  const usuario = (process.env.ADMIN_USER || 'admin').toLowerCase();
  let senha = process.env.ADMIN_PASSWORD;
  const gerada = !senha;
  if (gerada) senha = crypto.randomBytes(9).toString('base64url');
  await definirUsuario(usuario, senha);
  return { usuario, senha: gerada ? senha : null };
}

// hash fictício: login com usuário inexistente gasta o mesmo tempo (evita descobrir usuários pelo tempo de resposta)
let hashFicticio = null;

async function autenticar(usuario, senha) {
  usuario = String(usuario || '').trim().toLowerCase();
  senha = String(senha || '');
  const u = lerUsuarios().find((x) => x.usuario === usuario);
  if (!u) {
    hashFicticio ??= await hashSenha('fictício');
    await verificarSenha(senha, hashFicticio);
    return null;
  }
  return (await verificarSenha(senha, u.hash)) ? u.usuario : null;
}

/* ---------- sessões (em memória; reiniciar o servidor encerra as sessões) ---------- */
const sessoes = new Map();

function criarSessao(usuario) {
  const token = crypto.randomBytes(32).toString('hex');
  sessoes.set(token, { usuario, expira: Date.now() + cfg.SESSAO_TTL_MS });
  return token;
}

function sessaoDe(token) {
  if (!token) return null;
  const s = sessoes.get(token);
  if (!s) return null;
  if (s.expira < Date.now()) { sessoes.delete(token); return null; }
  return s;
}

const encerrarSessao = (token) => sessoes.delete(token);

setInterval(() => {
  const agora = Date.now();
  for (const [t, s] of sessoes) if (s.expira < agora) sessoes.delete(t);
}, 10 * 60 * 1000).unref();

/* ---------- limite de tentativas de login (por IP) ---------- */
const falhas = new Map();

function bloqueioRestante(ip) {
  const f = falhas.get(ip);
  if (!f) return 0;
  if (Date.now() - f.inicio > cfg.LOGIN_JANELA_MS) { falhas.delete(ip); return 0; }
  return f.qtd >= cfg.LOGIN_MAX_FALHAS ? cfg.LOGIN_JANELA_MS - (Date.now() - f.inicio) : 0;
}

function registrarFalha(ip) {
  const f = falhas.get(ip);
  if (!f || Date.now() - f.inicio > cfg.LOGIN_JANELA_MS) falhas.set(ip, { qtd: 1, inicio: Date.now() });
  else f.qtd++;
}

const limparFalhas = (ip) => falhas.delete(ip);

module.exports = {
  garantirAdmin, definirUsuario, autenticar, criarSessao, sessaoDe, encerrarSessao,
  bloqueioRestante, registrarFalha, limparFalhas, hashSenha, verificarSenha,
};
