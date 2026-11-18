# painel-atendimentos

Aplicação Node.js com Express e banco de dados configurável para SQLite ou PostgreSQL.

## Executar localmente

1. Instale as dependências:
   npm install
2. Copie o arquivo .env.example para .env e ajuste as variáveis.
3. Inicie a aplicação:
   npm start

## Variáveis de ambiente

- PORT: porta do servidor
- HOST: host de bind, use 0.0.0.0 para VPS
- DB_CLIENT: sqlite ou postgres
- DATABASE_URL: string de conexão para PostgreSQL

## Implantação na VPS

1. Envie o projeto para a VPS.
2. Instale Node.js e npm.
3. Instale as dependências:
   npm install
4. Defina as variáveis de ambiente no processo ou em um arquivo .env.
5. Inicie o processo com:
   npm start

Recomendação: rode o processo com PM2 para manter o servidor ativo.

## Estrutura do back-end

- `server.js`: cria o app Express, monta as rotas (na ordem abaixo) e inicia o servidor.
- `database.js`: conexão PostgreSQL e migrações de inicialização.
- `auth.js`: login (JWT) e verificação de permissões.
- `src/rotas/`: um arquivo por assunto. Cada um exporta um `express.Router`.
  - `auth`, `usuarios` (usuários e equipes), `cadastros` (consultores, canais, sistemas, convênios, produtos)
  - `lancamentos` (registros diários e dashboard), `geracao-leads`, `progestor`
  - `crm-webhook` (discadora), `crm-clientes` (clientes e tabulações), `crm-kanban`, `crm-admin`, `crm-documentos`, `crm-relatorios`
- `src/servicos/`: lógica compartilhada (Google Drive, eventos em tempo real do CRM, fila de Closers, filtros dos relatórios).
- `src/utils/`: funções puras (fuso de Brasília, formatação de CPF/CSV/valores).
- `src/middlewares/`: upload de PDF (multer).

## Estrutura do front-end

Sem etapa de build: `public/index.html` carrega os arquivos diretamente. **A ordem das tags importa** e os scripts compartilham o escopo global.

- `public/js/auth.js`: sessão e chamadas autenticadas (usado também no login).
- `public/js/app/`: telas gerais (`nucleo`, `navegacao`, `dados-base`, `dashboard`, `lancamentos`, `configuracoes`, `eventos`, `geracao-leads`, `usuarios`, `progestor`).
- `public/js/crm/`: CRM (`nucleo`, `multiselect`, `kanban`, `kanban-ux`, `kanban-export`, `clientes`, `admin`, `lead-detalhes`, `relatorios`, `relatorios-render`).
- `public/js/comum/`: menu lateral (`nav-groups`) e listas de escolha única (`select-ui`).
- `public/css/`: arquivos numerados na ordem da cascata. Não reordene: regras posteriores sobrescrevem as anteriores.
