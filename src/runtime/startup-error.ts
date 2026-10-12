import { logStartupFailure } from '@infrastructure/logging/startup-logger.js';
import type { LogRuntime } from '@infrastructure/logging/logging.types.js';

export function reportStartupError(error: unknown, runtime: LogRuntime) {
  logStartupFailure(error, runtime);
  process.exitCode = 1;
}
