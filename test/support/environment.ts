// Disposable fixture values only; these tests never connect to this database.
export const testEnvironment = {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5432',
  DB_NAME: 'runtime_test',
  DB_USER: 'runtime_test',
  DB_PASSWORD: 'fixture-password',
};
