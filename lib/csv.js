'use strict';
// Leitura/escrita de CSV (aspas, separador ; ou ,) com gravação atômica.
const fs = require('node:fs');

const separadores = new Map(); // arquivo -> separador detectado (preservado ao regravar)

function detectarSeparador(texto) {
  const cab = texto.split(/\r?\n/, 1)[0] || '';
  return cab.includes(';') || !cab.includes(',') ? ';' : ',';
}

function parse(texto, sep) {
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  const linhas = [];
  let linha = [], cel = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { cel += '"'; i++; } else aspas = false; }
      else cel += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(cel); cel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(cel); cel = ''; linhas.push(linha); linha = [];
    } else cel += c;
  }
  if (cel !== '' || linha.length) { linha.push(cel); linhas.push(linha); }
  return linhas.filter((l) => !(l.length === 1 && l[0].trim() === ''));
}

function escapar(v, sep) {
  const s = String(v ?? '');
  return s.includes(sep) || /["\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Lê o arquivo como lista de objetos (colunas pelo nome do cabeçalho). null se não existir. */
function lerTabela(arquivo) {
  if (!fs.existsSync(arquivo)) return null;
  const texto = fs.readFileSync(arquivo, 'utf8');
  const sep = detectarSeparador(texto.replace(/^\uFEFF/, ''));
  separadores.set(arquivo, sep);
  const linhas = parse(texto, sep);
  const cab = (linhas.shift() || []).map((c) => c.trim().toLowerCase());
  return linhas.map((l) => Object.fromEntries(cab.map((nome, i) => [nome, (l[i] ?? '').trim()])));
}

/** Grava via arquivo temporário + rename, para nunca deixar o CSV pela metade. */
function gravarTabela(arquivo, colunas, objetos) {
  const sep = separadores.get(arquivo) || ';';
  const linhas = [colunas.join(sep), ...objetos.map((o) => colunas.map((c) => escapar(o[c], sep)).join(sep))];
  const tmp = arquivo + '.tmp';
  fs.writeFileSync(tmp, linhas.join('\r\n') + '\r\n', 'utf8');
  fs.renameSync(tmp, arquivo);
}

module.exports = { lerTabela, gravarTabela };
