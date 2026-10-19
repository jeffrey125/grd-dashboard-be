import type { MigrationInterface, QueryRunner } from 'typeorm';

export class OptionalPackageDimensions1792800000000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`
      ALTER TABLE quote_package_groups
        ALTER COLUMN length_value DROP NOT NULL,
        ALTER COLUMN width_value DROP NOT NULL,
        ALTER COLUMN height_value DROP NOT NULL;
    `);
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query(`
      ALTER TABLE quote_package_groups
        ALTER COLUMN length_value SET NOT NULL,
        ALTER COLUMN width_value SET NOT NULL,
        ALTER COLUMN height_value SET NOT NULL;
    `);
  }
}
