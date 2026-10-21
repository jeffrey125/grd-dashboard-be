import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { constants } from 'node:fs';
import {
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BrowserContext } from 'playwright';
import { z } from 'zod';

export type AmazonStorageState = Awaited<
  ReturnType<BrowserContext['storageState']>
>;
export interface AmazonSessionStore {
  load(): Promise<AmazonStorageState | undefined>;
}

const MAX_BYTES = 4 * 1024 * 1024;
export const AMAZON_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const amazonDomain = (domain: string) =>
  domain === 'amazon.com' || domain.endsWith('.amazon.com');
/** Retain Amazon authentication only; CAPTCHA providers may set unrelated third-party state. */
export function amazonAuthenticationState(
  state: AmazonStorageState,
): AmazonStorageState {
  return {
    cookies: state.cookies.filter((cookie) => amazonDomain(cookie.domain)),
    origins: state.origins.filter((origin) => {
      const url = new URL(origin.origin);
      return url.protocol === 'https:' && amazonDomain(url.hostname);
    }),
  };
}

const storageSchema = z.object({
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string().refine(amazonDomain),
      path: z.string(),
      expires: z.number(),
      httpOnly: z.boolean(),
      secure: z.boolean(),
      sameSite: z.enum(['Strict', 'Lax', 'None']),
      partitionKey: z.string().optional(),
    }),
  ),
  origins: z.array(
    z.object({
      origin: z.url().refine((value) => {
        const url = new URL(value);
        return url.protocol === 'https:' && amazonDomain(url.hostname);
      }),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
    }),
  ),
});
const payloadSchema = z.strictObject({
  version: z.literal(1),
  account: z.string(),
  verifiedAt: z.number().int(),
  expiresAt: z.number().int(),
  state: storageSchema,
});
const envelopeSchema = z.strictObject({
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
  ciphertext: z.string().regex(/^[a-f0-9]+$/),
});

export class AmazonSessionError extends Error {
  constructor() {
    super(
      'Amazon session storage is unavailable; check its private directory and key file.',
    );
    this.name = 'AmazonSessionError';
  }
}

function externalPath(value: string): string {
  const path = resolve(value);
  const within = relative(process.cwd(), path);
  if (
    !isAbsolute(value) ||
    !within ||
    (within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within))
  )
    throw new AmazonSessionError();
  return path;
}

async function privateFile(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size > MAX_BYTES ||
      info.mode & 0o077 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new AmazonSessionError();
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** Only explicit operator/staff verification writes snapshots; quote attempts never refresh their expiry. */
export class EncryptedAmazonSessionStore implements AmazonSessionStore {
  private readonly directory: string;
  private readonly keyFile: string;
  private readonly account: string;

  constructor(
    directory: string,
    keyFile: string,
    email: string,
    private readonly now: () => number = Date.now,
  ) {
    this.directory = externalPath(directory);
    this.keyFile = externalPath(keyFile);
    if (this.keyFile === join(this.directory, 'session.enc'))
      throw new AmazonSessionError();
    if (!email.trim()) throw new AmazonSessionError();
    this.account = createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex');
  }

  private async checkDirectory() {
    const info = await stat(this.directory);
    if (
      (await realpath(this.directory)) !== this.directory ||
      !info.isDirectory() ||
      info.mode & 0o077 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new AmazonSessionError();
  }

  private async key() {
    if ((await realpath(this.keyFile)) !== this.keyFile)
      throw new AmazonSessionError();
    const text = (await privateFile(this.keyFile)).toString().trim();
    if (!/^[a-f0-9]{64}$/.test(text)) throw new AmazonSessionError();
    return Buffer.from(text, 'hex');
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.checkDirectory();
      if ((await realpath(dirname(this.keyFile))) !== dirname(this.keyFile))
        throw new AmazonSessionError();
      await writeFile(this.keyFile, randomBytes(32).toString('hex'), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch {
      throw new AmazonSessionError();
    }
  }

  async load(): Promise<AmazonStorageState | undefined> {
    try {
      await this.checkDirectory();
      const key = await this.key();
      const envelope = envelopeSchema.parse(
        JSON.parse(
          (await privateFile(join(this.directory, 'session.enc'))).toString(),
        ),
      );
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(envelope.iv, 'hex'),
      );
      decipher.setAAD(Buffer.from(this.account));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
      const payload = payloadSchema.parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(envelope.ciphertext, 'hex')),
            decipher.final(),
          ]).toString(),
        ),
      );
      if (
        payload.account !== this.account ||
        payload.verifiedAt > this.now() ||
        payload.expiresAt <= this.now() ||
        payload.expiresAt <= payload.verifiedAt ||
        payload.expiresAt - payload.verifiedAt > AMAZON_SESSION_TTL_MS
      )
        return undefined;
      return payload.state;
    } catch {
      // Never expose decrypt, filesystem or schema errors containing auth material.
      return undefined;
    }
  }

  async save(state: AmazonStorageState): Promise<void> {
    const temporary = join(
      this.directory,
      `.session-${randomBytes(16).toString('hex')}`,
    );
    try {
      await this.checkDirectory();
      const verifiedAt = this.now();
      const payload = payloadSchema.parse({
        version: 1,
        account: this.account,
        verifiedAt,
        expiresAt: verifiedAt + AMAZON_SESSION_TTL_MS,
        state,
      });
      const iv = randomBytes(12);
      const encryption = createCipheriv('aes-256-gcm', await this.key(), iv);
      encryption.setAAD(Buffer.from(this.account));
      const ciphertext = Buffer.concat([
        encryption.update(JSON.stringify(payload)),
        encryption.final(),
      ]);
      const serialized = JSON.stringify({
        iv: iv.toString('hex'),
        tag: encryption.getAuthTag().toString('hex'),
        ciphertext: ciphertext.toString('hex'),
      });
      if (Buffer.byteLength(serialized) > MAX_BYTES)
        throw new AmazonSessionError();
      await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 });
      await rename(temporary, join(this.directory, 'session.enc'));
    } catch {
      throw new AmazonSessionError();
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async revoke(): Promise<void> {
    try {
      await this.checkDirectory();
      await rm(join(this.directory, 'session.enc'), { force: true });
    } catch {
      throw new AmazonSessionError();
    }
  }
}

export function amazonSessionStore(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const directory = environment.AMAZON_SESSION_DIRECTORY?.trim();
  const keyFile = environment.AMAZON_SESSION_KEY_FILE?.trim();
  if (!directory && !keyFile) return undefined;
  if (!directory || !keyFile) throw new AmazonSessionError();
  return new EncryptedAmazonSessionStore(
    directory,
    keyFile,
    environment.AMAZON_SHIPPING_EMAIL ?? '',
  );
}
