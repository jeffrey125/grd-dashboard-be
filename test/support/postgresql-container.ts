import { PostgreSqlContainer } from '@testcontainers/postgresql';

export function startPostgresqlContainer() {
  return new PostgreSqlContainer('postgres:18.3-alpine')
    .withDatabase('grd_test')
    .withUsername('grd_test')
    .withPassword('grd_test')
    .withStartupTimeout(120_000)
    .start();
}
