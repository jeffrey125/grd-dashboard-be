import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const repository = 'jeffrey125/grd-dashboard-be';
const environment = 'production';
const required = [
  'AUTH_SECRET',
  'UPS_CLIENT_ID',
  'UPS_CLIENT_SECRET',
  'ECHOSHIP_URL',
  'ECHOSHIP_USERNAME',
  'ECHOSHIP_PASSWORD',
  'FFE_URL',
  'FFE_USERNAME',
  'FFE_PASSWORD',
];
const optional = ['DIGITALOCEAN_ACCESS_TOKEN', 'GHCR_CREDENTIALS'];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let file = fileURLToPath(new URL('../.env.production', import.meta.url));
let dryRun = false;
const args = process.argv.slice(2);

while (args.length) {
  const argument = args.shift();

  if (argument === '--dry-run') {
    dryRun = true;
  } else if (argument === '--file' && args[0] && !args[0].startsWith('--')) {
    file = args.shift()!;
  } else if (argument === '--help') {
    console.log('Usage: pnpm sync:production-env [--file PATH] [--dry-run]');
    console.log(
      'Uploads allowlisted secrets to grd-dashboard-be / production. No deployment.',
    );
    process.exit(0);
  } else {
    fail('Invalid arguments. Use --help.');
  }
}

let values: Record<string, string>;

try {
  values = Object.fromEntries(
    Object.entries(parseEnv(readFileSync(file, 'utf8'))).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
} catch {
  fail('Cannot read or parse the environment file. No secrets uploaded.');
}

const allowed = [...required, ...optional];

if (Object.keys(values).some((key) => !allowed.includes(key))) {
  fail(
    'Unexpected variable in environment file. Only documented production secrets are allowed.',
  );
}

for (const key of required) {
  if (!values[key]?.trim())
    fail(`Missing required setting: ${key}. No secrets uploaded.`);
}

if (values.AUTH_SECRET.length < 32)
  fail('AUTH_SECRET must contain at least 32 characters.');

const selected = allowed.filter((key) => values[key]?.trim());

for (const key of selected) {
  if (Buffer.byteLength(values[key]) > 48 * 1024)
    fail(`${key} exceeds GitHub's secret size limit.`);
}

console.log(`Target: ${repository} / ${environment}`);
console.log(`Settings: ${selected.join(', ')}`);
console.log(
  'Blank or absent optional tokens retain their existing GitHub values.',
);

if (dryRun) {
  console.log('Dry run passed. No secrets uploaded.');
  process.exit(0);
}

for (const key of selected) {
  // Never evaluate env text or put values in process arguments or diagnostics.
  const result = spawnSync(
    'gh',
    ['secret', 'set', key, '--repo', repository, '--env', environment],
    {
      input: values[key],
      env: { ...process.env, GH_DEBUG: '' },
      stdio: ['pipe', 'ignore', 'ignore'],
    },
  );

  if (result.error || result.status !== 0) {
    fail(
      `Upload failed for ${key}. Earlier uploads may have succeeded; rerun after fixing GitHub access.`,
    );
  }

  console.log(`Saved ${key}`);
}

console.log('Sync complete. No deployment triggered.');
