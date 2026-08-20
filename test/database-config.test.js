const test = require('node:test');
const assert = require('node:assert/strict');

const { validateDbConfig } = require('../database');

test('does not throw when DATABASE_URL is provided', () => {
  assert.doesNotThrow(() => {
    validateDbConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/painel'
    });
  });
});

test('does not throw when all host-based environment variables are provided', () => {
  assert.doesNotThrow(() => {
    validateDbConfig({
      DB_HOST: 'localhost',
      DB_USER: 'postgres',
      DB_PASSWORD: 'password',
      DB_NAME: 'painel'
    });
  });
});

test('throws when some host-based environment variables are missing', () => {
  assert.throws(() => {
    validateDbConfig({
      DB_HOST: 'localhost',
      DB_USER: 'postgres'
      // missing DB_PASSWORD and DB_NAME
    });
  }, /Variáveis de ambiente ausentes/);
});
