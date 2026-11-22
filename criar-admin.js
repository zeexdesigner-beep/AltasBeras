'use strict';
// Uso: npm run admin -- <usuario> <senha>
// Cria o usuário ou redefine a senha dele. A senha é gravada apenas como hash (scrypt).
const { definirUsuario } = require('./lib/auth');

const [usuario, senha] = process.argv.slice(2);
if (!usuario || !senha) {
  console.error('Uso: npm run admin -- <usuario> <senha>   (senha com 8+ caracteres)');
  process.exit(1);
}
definirUsuario(usuario, senha)
  .then((u) => console.log(`Usuário "${u}" salvo com sucesso.`))
  .catch((e) => { console.error('Erro:', e.message); process.exit(1); });
