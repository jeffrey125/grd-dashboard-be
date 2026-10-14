import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { createSecureContext } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { ConfigurationError } from '@config/env.schema.js';

/** pg forwards these options to Node TLS, including default hostname checks. */
export function databaseTls(
  mode: 'disable' | 'verify-full',
  caFile?: string,
): false | { rejectUnauthorized: true; ca?: string } {
  if (mode === 'disable') return false;

  if (!caFile) return { rejectUnauthorized: true };

  let descriptor: number | undefined;

  try {
    // Nonblocking open lets us reject FIFOs/devices without hanging startup.
    descriptor = openSync(caFile, constants.O_RDONLY | constants.O_NONBLOCK);

    const stat = fstatSync(descriptor);

    if (!stat.isFile() || stat.size === 0 || stat.size > 65_536) {
      throw new Error();
    }

    const ca = readFileSync(descriptor, 'utf8');
    const certificates = ca.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    );

    if (!certificates?.length) throw new Error();

    for (const certificate of certificates) new X509Certificate(certificate);

    createSecureContext({ ca });

    return { rejectUnauthorized: true, ca };
  } catch {
    // Paths, PEM contents and filesystem/OpenSSL errors must not reach logs.
    throw new ConfigurationError(['DB_SSL_CA_FILE']);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
