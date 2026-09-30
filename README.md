# Gás Renováveis — publicação Netlify + backend

Este projeto tem duas partes: **frontend** (páginas do site, publicadas no Netlify) e **backend/API** (login, banco de dados e operações). O Netlify sozinho não executa este servidor Express.

> **Importante antes de receber dinheiro real:** os produtos e rendimentos são valores configurados no projeto, não uma garantia de lucro. A aprovação administrativa não transfere dinheiro automaticamente. Não aceite depósitos reais até validar a atividade, os termos, a proteção de dados, a segurança e os requisitos legais aplicáveis em Angola, e integrar um meio de pagamento autorizado.

## Parte A — publicar o backend no Render

1. Descompacte o ZIP no computador. Para publicar via GitHub, crie um repositório privado e envie todos os ficheiros do projeto, incluindo `package.json`, `server/` e `public/`. **Não envie o ficheiro `.env` nem senhas reais.**
2. Entre em https://render.com e crie uma conta. Escolha **New + → Web Service** e ligue o repositório.
3. Configure o serviço:
   - **Root Directory:** deixe vazio se `package.json` estiver na raiz do repositório.
   - **Runtime:** Node.
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Em **Environment**, adicione estas variáveis:
   - `NODE_VERSION` = `20`
   - `JWT_SECRET` = uma chave longa, aleatória e exclusiva (não use o exemplo abaixo).
   - `ADMIN_EMAIL` = o teu e-mail de administrador.
   - `ADMIN_PASSWORD` = uma senha forte e exclusiva para o administrador.
   - `DATABASE_PATH` = `/var/data/gas-renovaveis.sqlite`
5. Em **Disks**, adicione um disco persistente montado em `/var/data` (confirme o custo e a disponibilidade no teu plano). É necessário porque o SQLite guarda dados em ficheiro; sem armazenamento persistente, podes perder dados em reinícios ou novas publicações.
6. Crie o serviço e espere que o estado fique **Live**. Copie o URL público que o Render fornecer, por exemplo `https://nome-do-servico.onrender.com`. Não invente o URL: use o que aparece no painel.
7. Teste no navegador `https://TEU-BACKEND.onrender.com/api/health`. Deve aparecer uma resposta JSON com `ok: true`. Substitua o exemplo pelo URL real do teu serviço.

### Se o backend não iniciar

- Abra **Logs** no Render e leia o primeiro erro.
- Confirme que `npm install` terminou sem erro. `better-sqlite3` inclui um módulo nativo, por isso use um ambiente Node compatível.
- Confirme que o disco está montado em `/var/data` e que `DATABASE_PATH` é exatamente `/var/data/gas-renovaveis.sqlite`.
- Confirme que `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `JWT_SECRET` estão definidos. Nunca partilhe esses valores.

## Parte B — ligar o site ao backend

1. Abra `public/config.js` num editor de texto.
2. Altere a linha `window.GR_API_URL = "";` para o URL real do backend, por exemplo:

   `window.GR_API_URL = "https://nome-do-servico.onrender.com";`

   Use o teu URL real, sem `/` no fim.
3. Guarde o ficheiro.

## Parte C — publicar o frontend no Netlify

### Opção simples: carregar a pasta do site

1. Entre em https://app.netlify.com e crie uma conta/inicie sessão.
2. No painel, escolha a opção de adicionar um site manualmente (o nome do botão pode variar, por exemplo **Add new site → Deploy manually**).
3. Carregue **o conteúdo da pasta `public`** — incluindo `index.html`, `styles.css`, `app.js` e `config.js`. Não carregue apenas o `index.html`.
4. Espere a publicação e abra o URL `*.netlify.app` que o Netlify fornecer.
5. Teste cadastro/login e confirme no navegador que a página consegue comunicar com o backend.

### Para atualizar depois

Edite os ficheiros dentro de `public` e carregue novamente a pasta `public` no deploy manual do Netlify. Se alterares o backend, publica também a versão atualizada no Render.

## Painel administrativo

O projeto inclui `admin/index.html`, mas verifica o fluxo e os endpoints administrativos antes de o usar em produção. Se publicares o frontend apenas pelo conteúdo de `public`, a pasta `admin` não será enviada. Para disponibilizar essa página no Netlify, copia também o conteúdo de `admin` para uma pasta pública (por exemplo `public/admin`) antes do deploy e confirma que o login administrativo está funcional. **Não exponhas credenciais de administrador no frontend.**

## Configuração local para testar

1. Instale Node.js 20 ou superior: https://nodejs.org
2. Na pasta principal do projeto, crie `.env` a partir de `.env.example` e preencha as variáveis com valores de teste.
3. No terminal, execute `npm install` e depois `npm start`.
4. Abra `http://localhost:3000`.
5. A verificação da API está em `http://localhost:3000/api/health`.

O Node não carrega automaticamente `.env` neste projeto; defina as variáveis no terminal/ambiente, ou configure um carregador de variáveis antes de depender desse ficheiro localmente. No Render, use o painel **Environment**.

## Antes de colocar em produção

- Configurar CORS para aceitar apenas o domínio Netlify e o domínio próprio, se houver.
- Ativar HTTPS e configurar domínio, política de privacidade e termos.
- Implementar verificação de telefone e recuperação segura de senha.
- Rever as regras de saldo e o ciclo de vida dos investimentos: o código atual é um ponto de partida e não substitui uma contabilidade financeira validada.
- Integrar um provedor de pagamentos autorizado; aprovar um pedido no painel não efetua uma transferência bancária.
- Adicionar backups e testar a recuperação do banco de dados.
- Rever segurança, autorização do painel administrativo, registos de auditoria e limites de acesso.
- Testar todos os fluxos com valores fictícios antes de qualquer utilização real.

## Estrutura

- `public/` — interface do investidor e ficheiro de configuração da API.
- `admin/` — interface administrativa de base.
- `server/` — API Express e base de dados SQLite.
- `.env.example` — nomes das variáveis de ambiente; não contém segredos válidos.
