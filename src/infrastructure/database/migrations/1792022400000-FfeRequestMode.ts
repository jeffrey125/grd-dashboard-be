import type { MigrationInterface, QueryRunner } from 'typeorm';

/** FFE was reserved for browser before the adapter existed. No run history changes. */
export class FfeRequestMode1792022400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "UPDATE carriers SET fetch_mode = 'request' WHERE code = 'ffe'",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "UPDATE carriers SET fetch_mode = 'browser' WHERE code = 'ffe'",
    );
  }
}
