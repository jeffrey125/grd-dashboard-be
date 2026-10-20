import { it, expect } from 'vitest';
import { shipmentDatabase } from '@test/support/shipment-database.js';

it('keeps provider administration mappings aligned with migrated PostgreSQL', async () => {
  const db = await shipmentDatabase();
  try {
    const changes = await db.source.driver.createSchemaBuilder().log();
    expect(changes.upQueries.map((query) => query.query)).toEqual([]);
  } finally {
    await db.close();
  }
});
