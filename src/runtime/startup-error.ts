import { ConfigurationError } from '../config/env.schema.js';

export function reportStartupError(error: unknown) {
  console.error(
    error instanceof ConfigurationError
      ? error.message
      : 'Application startup failed. Check runtime configuration and port availability.',
  );
  process.exitCode = 1;
}
