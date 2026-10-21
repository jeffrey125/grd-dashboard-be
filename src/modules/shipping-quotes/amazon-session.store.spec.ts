import {
  mkdtemp,
  readFile,
  rm,
  chmod,
  stat,
  writeFile,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AMAZON_SESSION_TTL_MS,
  EncryptedAmazonSessionStore,
  amazonSessionStore,
} from './amazon-session.store.js';

const state = {
  cookies: [
    {
      name: 'session-id',
      value: 'private-fixture-cookie',
      domain: '.amazon.com',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: 'None' as const,
    },
  ],
  origins: [],
};
let directory: string;
let keyFile: string;
let now: number;
let store: EncryptedAmazonSessionStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'amazon-session-test-'));
  keyFile = join(directory, 'key');
  now = Date.now();
  store = new EncryptedAmazonSessionStore(
    directory,
    keyFile,
    'fixture@example.test',
    () => now,
  );
  await store.initialize();
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('Encrypted Amazon session snapshots', () => {
  it('restores across instances without persisting plaintext and restricts file permissions', async () => {
    await store.save(state);
    const restored = new EncryptedAmazonSessionStore(
      directory,
      keyFile,
      'fixture@example.test',
      () => now,
    );
    expect(await restored.load()).toEqual(state);
    const file = join(directory, 'session.enc');
    expect(await readFile(file, 'utf8')).not.toContain(
      'private-fixture-cookie',
    );
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    const original = await readFile(keyFile);
    await expect(store.initialize()).rejects.toThrow('Amazon session storage');
    expect(await readFile(keyFile)).toEqual(original);
  });

  it('expires without sliding the deadline on reads and supports revocation', async () => {
    await store.save(state);
    now += AMAZON_SESSION_TTL_MS - 1;
    expect(await store.load()).toEqual(state);
    now += 1;
    expect(await store.load()).toBeUndefined();
    await store.save(state);
    await store.revoke();
    expect(await store.load()).toBeUndefined();
  });

  it('rejects another account, a changed key and corrupted ciphertext', async () => {
    await store.save(state);
    expect(
      await new EncryptedAmazonSessionStore(
        directory,
        keyFile,
        'other@example.test',
      ).load(),
    ).toBeUndefined();
    const original = await readFile(keyFile);
    await writeFile(keyFile, 'a'.repeat(64));
    expect(await store.load()).toBeUndefined();
    await writeFile(keyFile, original);
    const file = join(directory, 'session.enc');
    const envelope = JSON.parse(await readFile(file, 'utf8'));
    envelope.ciphertext =
      (envelope.ciphertext.startsWith('00') ? 'ff' : '00') +
      envelope.ciphertext.slice(2);
    await writeFile(file, JSON.stringify(envelope));
    expect(await store.load()).toBeUndefined();
  });

  it('refuses permissive storage, symlinked secrets and unrelated browser origins', async () => {
    await store.save(state);
    await chmod(directory, 0o755);
    expect(await store.load()).toBeUndefined();
    await expect(store.save(state)).rejects.toThrow('Amazon session storage');
    await chmod(directory, 0o700);
    await chmod(keyFile, 0o644);
    expect(await store.load()).toBeUndefined();
    await chmod(keyFile, 0o600);
    const link = join(directory, 'key-link');
    await symlink(keyFile, link);
    expect(
      await new EncryptedAmazonSessionStore(
        directory,
        link,
        'fixture@example.test',
      ).load(),
    ).toBeUndefined();
    await expect(
      store.save({
        ...state,
        origins: [{ origin: 'https://example.com', localStorage: [] }],
      }),
    ).rejects.toThrow('Amazon session storage');
    expect(await store.load()).toEqual(state);
  });

  it('keeps storage opt-in and rejects partial configuration or paths in the checkout', () => {
    expect(amazonSessionStore({})).toBeUndefined();
    expect(() =>
      amazonSessionStore({ AMAZON_SESSION_DIRECTORY: directory }),
    ).toThrow('Amazon session storage');
    expect(
      () =>
        new EncryptedAmazonSessionStore(
          process.cwd(),
          keyFile,
          'fixture@example.test',
        ),
    ).toThrow('Amazon session storage');
  });
});
