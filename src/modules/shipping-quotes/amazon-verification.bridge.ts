import { createServer, request, type Server } from 'node:http';
import { chmod, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative } from 'node:path';
import { z } from 'zod';
import {
  VerificationError,
  verificationCommandSchema,
  verificationErrorSchema,
  verificationViewSchema,
  type VerificationCommand,
  type VerificationView,
} from './amazon-verification.contract.js';

const responseSchema = z.union([
  z.strictObject({ view: verificationViewSchema }),
  z.strictObject({ error: verificationErrorSchema }),
]);

/** Private Unix socket shared by the one API and one worker. Never a published TCP listener. */
export class AmazonVerificationBridge {
  private server?: Server;
  constructor(
    private readonly socket = process.env.AMAZON_VERIFICATION_SOCKET,
  ) {}

  async listen(
    handle: (command: VerificationCommand) => Promise<VerificationView>,
  ) {
    if (!this.socket) return;
    if (!isAbsolute(this.socket))
      throw new Error('Amazon verification socket must be absolute');
    const directory = dirname(this.socket);
    const stat = await lstat(directory);
    const inside = relative(process.cwd(), directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.() ||
      (await realpath(directory)) !== directory ||
      (!inside.startsWith('..') && !isAbsolute(inside))
    )
      throw new Error(
        'Amazon verification needs a private runtime directory outside the checkout',
      );
    this.server = createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try {
        if (req.method !== 'POST' || req.url !== '/verification')
          throw new VerificationError('unavailable');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > 8192) throw new VerificationError('unavailable');
          chunks.push(chunk as Buffer);
        }
        const command = verificationCommandSchema.parse(
          JSON.parse(Buffer.concat(chunks).toString()),
        );
        res.end(JSON.stringify({ view: await handle(command) }));
      } catch (error) {
        res.end(
          JSON.stringify({
            error:
              error instanceof VerificationError ? error.code : 'unavailable',
          }),
        );
      }
    });
    this.server.requestTimeout = 15_000;
    this.server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.socket!, () => resolve());
    });
    await chmod(this.socket, 0o600);
  }

  async send(command: VerificationCommand): Promise<VerificationView> {
    if (!this.socket) throw new VerificationError('unavailable');
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socket,
          path: '/verification',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          timeout: 15_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 4_000_000) req.destroy();
            else chunks.push(chunk);
          });
          res.on('error', () => reject(new VerificationError('unavailable')));
          res.on('end', () => {
            try {
              const result = responseSchema.parse(
                JSON.parse(Buffer.concat(chunks).toString()),
              );
              if ('error' in result)
                reject(new VerificationError(result.error));
              else resolve(result.view);
            } catch {
              reject(new VerificationError('unavailable'));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => reject(new VerificationError('unavailable')));
      req.end(JSON.stringify(command));
    });
  }

  async close() {
    if (!this.server?.listening) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}
