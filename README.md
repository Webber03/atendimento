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
