import 'reflect-metadata';
import pino from 'pino';
import { PinoLogger } from 'nestjs-pino';
import { PinoLoggerService } from '@infrastructure/logging/pino-logger.service.js';
import { createBaseLoggingOptions } from '@infrastructure/logging/logging.options.js';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import source from '@infrastructure/database/data-source.js';
import { authConfiguration } from '@modules/auth/auth.config.js';
import { createAuthEngine } from '@modules/auth/auth.engine.js';
import { TypeOrmAuthRepository } from '@modules/auth/typeorm-auth.repository.js';
import { AuthService } from '@modules/auth/auth.service.js';

async function prompt(label: string, hidden = false) {
  const output = hidden
    ? new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      })
    : stdout;
  const reader = createInterface({ input: stdin, output, terminal: true });
  const cancellation = new AbortController();
  reader.once('SIGINT', () => cancellation.abort());
  stdout.write(label);
  try {
    return await reader.question('', { signal: cancellation.signal });
  } finally {
    reader.close();
    if (hidden) stdout.write('\n');
  }
}

try {
  const command = process.argv[2];
  if (
    !stdin.isTTY ||
    !stdout.isTTY ||
    process.argv.length !== 3 ||
    !['bootstrap', 'recover'].includes(command ?? '')
  ) {
    throw new Error(
      'Use bootstrap or recover in an interactive terminal; credentials cannot be supplied as arguments.',
    );
  }
  const config = authConfiguration(process.env);
  const email = await prompt('Email: ');
  const names =
    command === 'bootstrap'
      ? {
          firstName: await prompt('First name: '),
          lastName: await prompt('Last name: '),
        }
      : {};
  const password = await prompt('Issued password (hidden): ', true);
  if (password !== (await prompt('Confirm password (hidden): ', true)))
    throw new Error('Passwords do not match');
  await source.initialize();
  const auth = new AuthService(
    new TypeOrmAuthRepository(source),
    createAuthEngine(source, config),
    new PinoLoggerService(
      new PinoLogger({
        pinoHttp: [
          createBaseLoggingOptions(
            process.env.NODE_ENV ?? 'development',
            'api',
            'info',
          ),
          pino.destination({ dest: 2, sync: true }),
        ],
      }),
    ),
  );
  if (command === 'bootstrap')
    await auth.bootstrap({ ...names, email, password, role: 'admin' });
  else await auth.recoverAdmin(email, { password });
  stdout.write(
    'Administrator credential saved. A password change is required at next login.\n',
  );
} catch {
  // Never print database errors, submitted values, or credentials to terminal logs.
  process.stderr.write(
    'Administrator operation failed. Check the command, interactive terminal, configuration, account state, and password requirements.\n',
  );
  process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
