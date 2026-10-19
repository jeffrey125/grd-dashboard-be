import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AmazonQuoteBreakdown1792713600000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`
      ALTER TABLE shipping_quotes
        ADD COLUMN group_contributions jsonb NOT NULL DEFAULT '[]'::jsonb
          CONSTRAINT shipping_quotes_group_contributions_array_check
          CHECK (jsonb_typeof(group_contributions) = 'array');
    `);
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query(
      'ALTER TABLE shipping_quotes DROP COLUMN group_contributions',
    );
  }
}
