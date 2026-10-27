import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
  new URL('./sync-production-env.ts', import.meta.url),
);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'grd-env-sync-'));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const file = join(directory, '.env.production');
  const values = {
    AUTH_SECRET: 'fixture-auth-value-with-at-least-32-characters',
    UPS_CLIENT_ID: 'fixture-id',
    UPS_CLIENT_SECRET: `literal-$(touch ${directory}/executed)-value`,
    ECHOSHIP_URL: 'https://example.test/#tracking',
    ECHOSHIP_USERNAME: 'fixture-user',
    ECHOSHIP_PASSWORD: 'literal $VALUE # spaces',
    FFE_URL: 'https://example.test',
    FFE_USERNAME: 'fixture-user',
    FFE_PASSWORD: 'fixture-password',
  };
  const content = Object.entries(values)
    .map(([key, value]) => `${key}='${value}'`)
    .join('\n');
  writeFileSync(file, content);
  writeFileSync(
    join(bin, 'gh'),
    `#!${process.execPath}
const fs = require('fs');
const input = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.CAPTURE, JSON.stringify({args:process.argv.slice(2), input})+'\\n');
console.error(input);
process.exit(process.env.FAIL_UPLOAD === '1' ? 1 : 0);
`,
    { mode: 0o700 },
  );
  const capture = join(directory, 'capture');
  const run = (args: string[] = [], extra: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script, '--file', file, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CAPTURE: capture,
        ...extra,
      },
    });

  return {
    directory,
    file,
    values,
    content,
    capture,
    run,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('uploads exact values via stdin to fixed production target without exposing or executing values', () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0);
    const records = readFileSync(f.capture, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(records.length, 9);
    for (const [key, value] of Object.entries(f.values)) {
      const record = records.find((record) => record.args[2] === key);
      assert.deepEqual(record.args, [
        'secret',
        'set',
        key,
        '--repo',
        'jeffrey125/grd-dashboard-be',
        '--env',
        'production',
      ]);
      assert.equal(record.input, value);
      assert.ok(!(result.stdout + result.stderr).includes(value));
    }
    assert.equal(existsSync(join(f.directory, 'executed')), false);
  } finally {
    f.cleanup();
  }
});

test('dry run and invalid files never upload', () => {
  const f = fixture();
  try {
    assert.equal(f.run(['--dry-run']).status, 0);
    assert.equal(existsSync(f.capture), false);
    for (const content of [
      '',
      f.content + '\nUNKNOWN=fixture',
      f.content.replace('UPS_CLIENT_ID=', 'MISSING='),
      f.content + '\nAUTH_SECRET=short',
    ]) {
      writeFileSync(f.file, content);
      assert.notEqual(f.run().status, 0);
      assert.equal(existsSync(f.capture), false);
    }
  } finally {
    f.cleanup();
  }
});

test('optional tokens upload only when populated and failed uploads suppress CLI diagnostics', () => {
  const f = fixture();
  try {
    writeFileSync(
      f.file,
      f.content +
        '\nDIGITALOCEAN_ACCESS_TOKEN=fixture-token\nGHCR_CREDENTIALS=',
    );
    assert.equal(f.run().status, 0);
    assert.equal(readFileSync(f.capture, 'utf8').trim().split('\n').length, 10);
    const result = f.run([], { FAIL_UPLOAD: '1' });
    assert.notEqual(result.status, 0);
    assert.ok(!(result.stdout + result.stderr).includes(f.values.AUTH_SECRET));
    assert.match(result.stderr, /Earlier uploads may have succeeded/);
  } finally {
    f.cleanup();
  }
});
