import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

export function startPostgresqlContainer() {
  return new PostgreSqlContainer('postgres:18.3-alpine')
    .withDatabase('grd_test')
    .withUsername('grd_test')
    .withPassword('$UNSET_LITERAL_PASSWORD')
    .withStartupTimeout(120_000)
    .start();
}

export function postgresqlEnvironment(container: StartedPostgreSqlContainer) {
  return {
    NODE_ENV: 'test',
    AUTH_SECRET: 'test-secret-'.repeat(4),
    AUTH_BASE_URL: 'http://api.example.test',
    AUTH_TRUSTED_ORIGINS: 'http://dashboard.example.test',
    DB_HOST: container.getHost(),
    DB_PORT: String(container.getPort()),
    DB_NAME: container.getDatabase(),
    DB_USER: container.getUsername(),
    DB_PASSWORD: container.getPassword(),
  };
}
