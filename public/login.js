'use strict';
const form = document.getElementById('formLogin');
const erro = document.getElementById('erro');
const botao = document.getElementById('entrar');
const campoSenha = document.getElementById('senha');
const verSenha = document.getElementById('verSenha');

function mostrarErro(texto) {
  erro.textContent = texto;
  erro.hidden = false;
}

verSenha.addEventListener('click', () => {
  const mostrar = campoSenha.type === 'password';
  campoSenha.type = mostrar ? 'text' : 'password';
  verSenha.textContent = mostrar ? 'Ocultar' : 'Mostrar';
  verSenha.setAttribute('aria-pressed', String(mostrar));
  verSenha.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
});

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  erro.hidden = true;
  const usuario = form.usuario.value.trim();
  const senha = campoSenha.value;
  if (!usuario || !senha) return mostrarErro('Informe usuário e senha.');

  botao.disabled = true;
  botao.textContent = 'Entrando…';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
    const corpo = await r.json().catch(() => ({}));
    if (r.ok) { window.location.replace('/'); return; }
    mostrarErro(corpo.erro || 'Não foi possível entrar.');
    campoSenha.value = '';
    campoSenha.focus();
  } catch {
    mostrarErro('Sem conexão com o servidor. Verifique se o sistema está em execução.');
  }
  botao.disabled = false;
  botao.textContent = 'Entrar';
});
