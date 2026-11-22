# Altas Beras — Gestão de Distribuidora

Sistema web simples para controlar **estoque** e **vendas** de uma distribuidora de bebidas e itens de conveniência. Roda em **Node.js puro**, sem dependências externas e sem banco de dados: tudo fica em arquivos CSV fáceis de abrir no Excel.

## O problema que resolve

Pequenas distribuidoras costumam controlar estoque e vendas em cadernos ou planilhas soltas. Isso causa:

- **Estoque desatualizado**: a venda é feita, mas ninguém desconta a quantidade do produto.
- **Falta de visão do negócio**: não se sabe quais produtos mais saem, quanto se fatura nem qual é o lucro.
- **Ruptura de estoque**: o produto acaba sem aviso, porque ninguém percebe que estava baixo.
- **Histórico incorreto**: ao mudar o preço de um produto, as vendas antigas ficam com valor errado.
- **Dados sem proteção**: planilhas abertas a qualquer pessoa, sem controle de acesso.

O Altas Beras resolve isso com um sistema único onde cada venda **baixa o estoque automaticamente**, o painel mostra **faturamento, lucro estimado, ranking e alertas de estoque baixo**, e o acesso é protegido por **login e senha**.

## Funcionalidades

| Tela | O que faz |
|---|---|
| **Painel** | Total de produtos, itens em estoque, vendas registradas, faturamento, lucro estimado, ranking dos 5 produtos mais vendidos, lista de estoque baixo e últimas vendas |
| **Produtos** | Cadastrar, buscar (por código ou nome), editar e remover produtos (limite de 100) |
| **Nova venda** | Busca por código ou nome com sugestões, carrinho com várias linhas, confirmação que baixa o estoque |
| **Histórico** | Lista todas as vendas registradas com quantidade, estoque restante e total |
| **Login** | Acesso restrito por usuário e senha, com sessão de 8 horas |

## Requisitos

- **Node.js 18 ou superior** ([nodejs.org](https://nodejs.org))
- Nenhum `npm install` é necessário

Para conferir a versão instalada:

```bash
node --version
```

## Como executar

1. Extraia o projeto e abra um terminal dentro da pasta `altas-beras`.
2. Inicie o servidor:

   ```bash
   npm start
   ```

   (equivalente a `node server.js`)

3. Na **primeira execução**, o sistema cria sozinho:
   - `data/produtos.csv` com 20 produtos de exemplo;
   - `data/vendas.csv` com 2 vendas de exemplo;
   - o usuário **`admin`**, com uma **senha aleatória exibida no terminal uma única vez**. Anote-a.

4. Abra o navegador em **<http://localhost:3000>** e entre com o usuário e a senha mostrados.

Para encerrar o servidor, pressione `Ctrl + C` no terminal.

### Definir a senha inicial

Para escolher você mesmo a senha do administrador (mínimo de 8 caracteres), defina-a antes da primeira execução:

```bash
# Linux / macOS
ADMIN_PASSWORD="minha-senha-forte" npm start

# Windows (PowerShell)
$env:ADMIN_PASSWORD="minha-senha-forte"; npm start

# Windows (Prompt de Comando)
set ADMIN_PASSWORD=minha-senha-forte
npm start
```

> **Atenção:** `ADMIN_PASSWORD` só vale na **primeira execução**, enquanto ainda não existe nenhum usuário. Se `data/usuarios.json` já existe, a variável é ignorada. Para trocar a senha depois, use `npm run admin` (veja abaixo).

### Criar usuários ou redefinir senhas

```bash
npm run admin -- <usuario> <nova-senha>
```

Exemplo: `npm run admin -- maria senha-segura-123`. Se o usuário já existir, a senha dele é trocada. Também serve para recuperar o acesso caso a senha do admin seja esquecida.

- A senha precisa ter no mínimo **8 caracteres**; o usuário, de 3 a 30 caracteres (letras minúsculas, números, ponto, hífen ou sublinhado).
- Se o terminal não repassar os argumentos, use o comando direto: `node criar-admin.js <usuario> <nova-senha>`.
- A nova senha vale na hora, sem reiniciar o servidor. Ela é gravada apenas como hash em `data/usuarios.json` e **permanece salva** após reiniciar.

### Variáveis de ambiente

| Variável | Padrão | Função |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `HOST` | `127.0.0.1` | Aceita acessos só do próprio computador. Use `0.0.0.0` para liberar para a rede local |
| `ADMIN_USER` | `admin` | Nome do administrador criado na primeira execução |
| `ADMIN_PASSWORD` | aleatória | Senha do administrador criado na primeira execução |
| `DATA_DIR` | `./data` | Pasta onde ficam os dados |

> **Uso em rede:** o servidor fala HTTP. Se for liberar o acesso a outros computadores (`HOST=0.0.0.0`), coloque-o atrás de HTTPS (por exemplo com Nginx ou Caddy). O cookie de sessão recebe a flag `Secure` automaticamente quando detecta `X-Forwarded-Proto: https`.

## Como usar

### 1. Entrar no sistema

Acesse `http://localhost:3000`, informe usuário e senha e clique em entrar. Após 5 tentativas erradas em 15 minutos, o acesso é bloqueado temporariamente para aquele endereço. Use **Sair** no menu lateral para encerrar a sessão. Reiniciar o servidor também encerra todas as sessões abertas.

### 2. Cadastrar produtos

1. Vá em **Produtos** e clique em **Cadastrar produto**.
2. Preencha **todos** os campos: nome, fornecedor, estoque inicial, preço de compra e preço de venda (use vírgula ou ponto nos centavos).
3. O **código** é opcional: deixando em branco, o sistema usa o próximo disponível. Ele não pode repetir.
4. Para corrigir um produto, use **Alterar** na linha dele; para excluir, **Remover** (há uma confirmação). O histórico de vendas é mantido.

Regras: nome e fornecedor são obrigatórios (até 60 caracteres); estoque inicial e preços devem ser **maiores que zero** (preço mínimo de R$ 0,01); o estoque deve ser um número inteiro; o código, quando informado, deve ser um inteiro maior que zero. Ao **alterar** um produto o estoque pode ser 0 (produto esgotado), mas os preços continuam maiores que zero.

### 3. Registrar uma venda

1. Vá em **Nova venda**.
2. Digite o **código** (ex.: `4`) ou parte do **nome** (ex.: `brahma`, `coca 2l`) e escolha o produto nas sugestões.
3. Informe a quantidade (campo ou botões **−** / **+**) e clique em **Adicionar à venda**. Repita para outros produtos.
4. Confira o **Resumo** à direita e clique em **Confirmar venda**.

O sistema valida tudo antes de gravar: se algum item não tiver estoque suficiente, **nada é registrado** e uma mensagem explica qual produto está faltando. Ao confirmar, o estoque é descontado e a venda entra no histórico e no painel.

### 4. Acompanhar o negócio

- **Painel**: veja faturamento, lucro estimado (venda menos custo), o ranking de **Produtos Mais Vendidos** (por unidades) e os produtos com **estoque baixo** (12 unidades ou menos).
- **Histórico**: consulte todas as vendas. Os valores guardam o preço **da época**, então alterar o preço de um produto depois não muda vendas antigas.

## Dados e backup

Os dados ficam na pasta `data/`:

| Arquivo | Conteúdo |
|---|---|
| `produtos.csv` | `codigo;nome;fornecedor;estoque;preco_compra;preco_venda` |
| `vendas.csv` | `id;pedido;data;codigo;produto;quantidade;preco_unit;custo_unit;total;estoque_restante;status` |
| `usuarios.json` | Usuários e senhas (somente hash, nunca a senha em texto) |

- Os CSVs usam **`;` como separador** e abrem no Excel. Os decimais usam ponto (ex.: `7.00`); se o Excel em português interpretar errado, abra por *Dados > De Texto/CSV* e escolha o ponto como separador decimal.
- O sistema relê os arquivos a cada requisição: edições manuais aparecem sem reiniciar.
- Em `vendas.csv`, cada linha é um produto vendido; linhas com o mesmo `pedido` foram vendidas juntas. Marcar `status` como `cancelada` retira a linha do ranking e dos totais.
- **Backup**: basta copiar a pasta `data/` regularmente.
- **Levar para outro computador**: o `usuarios.json` fica dentro de `data/`. Copiar a pasta `data/` leva junto produtos, vendas **e a senha do admin**. Copiando só o código (sem `data/`), o outro computador cria os dados de exemplo e uma conta `admin` nova, com senha aleatória (ou a de `ADMIN_PASSWORD`).

## Testes

```bash
npm test               # testes da API: login, permissões, vendas, ranking e CSV
node tests/e2e-ui.js   # testes de interface em navegador real (requer Playwright)
```

Os testes usam uma pasta temporária e nunca alteram `data/`.

## Estrutura do projeto

```
server.js          servidor HTTP, rotas e cabeçalhos de segurança
criar-admin.js     cria/redefine usuários pela linha de comando
lib/auth.js        hash scrypt, sessões e limite de tentativas
lib/dados.js       regras de negócio: produtos, vendas, painel e ranking
lib/csv.js         leitura e escrita de CSV com gravação atômica
lib/config.js      configurações e variáveis de ambiente
public/            login e arquivos estáticos (acesso livre)
app/               interface principal (só com sessão válida)
data/              CSVs e usuários (nunca servidos pelo site)
tests/             testes automatizados
```

## Segurança

- Senhas guardadas apenas como hash **scrypt** com sal individual.
- Sessão por cookie `HttpOnly` + `SameSite=Strict`, token aleatório, expiração em 8 h e invalidação no logout.
- Páginas internas e API exigem login (sem sessão: redirecionamento ou erro 401).
- Bloqueio após 5 tentativas de login erradas em 15 minutos.
- Proteção contra CSRF, Content-Security-Policy, `X-Frame-Options` e `nosniff`.
- Somente uma lista fixa de arquivos é servida (sem *path traversal*; `data/` e o código-fonte ficam inacessíveis).
- Validação de todos os dados no servidor e proteção contra injeção de fórmulas ao abrir CSV no Excel.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| `EADDRINUSE` ao iniciar | A porta já está em uso. Rode com outra: `PORT=3001 npm start` (Linux/macOS), `$env:PORT=3001; npm start` (PowerShell) ou `set PORT=3001` e depois `npm start` (Prompt de Comando) |
| Esqueci a senha do admin | `npm run admin -- admin nova-senha-forte` |
| Outro computador não consegue acessar | Inicie com `HOST=0.0.0.0` e libere a porta no firewall (veja o aviso sobre HTTPS acima) |
| Quero começar do zero | Pare o servidor e apague `data/produtos.csv` e `data/vendas.csv`; os dados de exemplo serão recriados na próxima execução. A senha do admin é mantida (para zerá-la também, apague `data/usuarios.json`) |

## Integrantes

- Danilo Maisumi Mota
- Miguel Ahmad Brasil Nossabein
- Renan Cavalheiro dos Santos
- Vinicius Martins Miranda
- Vinicius Vieira de Camargo
- Wellington de Sousa Guimarães

## Licença

Uso interno (`UNLICENSED`).
