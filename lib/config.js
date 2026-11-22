'use strict';
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

module.exports = {
  RAIZ,
  DATA_DIR: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(RAIZ, 'data'),
  PORT: Number(process.env.PORT) || 3000,
  // Por padrão só aceita conexões da própria máquina. Para uso em rede: HOST=0.0.0.0
  HOST: process.env.HOST || '127.0.0.1',
  MAX_PRODUTOS: 100,
  LIMITE_ESTOQUE_BAIXO: 12,
  SESSAO_TTL_MS: 8 * 60 * 60 * 1000,
  LOGIN_MAX_FALHAS: 5,
  LOGIN_JANELA_MS: 15 * 60 * 1000,
};
