import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

// Build first. Imports are delayed until arguments and source checksum are validated.
const { values } = parseArgs({
  options: {
    plan: { type: 'string' },
    csv: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});
if (!values.plan || !values.csv)
  throw new Error(
    'Use --plan PATH --csv PATH [--apply]. Default is read-only.',
  );
if (
  process.env.NODE_ENV !== 'test' &&
  process.env.DB_SSL_MODE !== 'verify-full'
)
  throw new Error('Operator backfills require DB_SSL_MODE=verify-full.');
const plan = JSON.parse(await readFile(values.plan, 'utf8'));
const { shipmentBackfillPlanSchema, runShipmentBackfill } =
  await import('../dist/modules/shipments/typeorm-shipment-backfill.js');
const parsed = shipmentBackfillPlanSchema.parse(plan);
const digest = createHash('sha256')
  .update(await readFile(values.csv))
  .digest('hex');
if (digest !== parsed.sourceSha256)
  throw new Error('Source CSV checksum differs from the reviewed plan.');
const { default: source } =
  await import('../dist/infrastructure/database/data-source.js');
try {
  await source.initialize();
  console.log(
    JSON.stringify(await runShipmentBackfill(source, parsed, values.apply)),
  );
} catch {
  // Connection errors may contain credentials or private source values.
  console.error(
    'Backfill stopped. No partial changes committed. Recheck the plan, schema and connection.',
  );
  process.exitCode = 1;
} finally {
  if (source.isInitialized) await source.destroy();
}
