import type { MigrationInterface, QueryRunner } from 'typeorm';
import source from './data-source.js';

class FailingProof1791800000001 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('CREATE TABLE rollback_proof (id integer)');
    await runner.query('SELECT $1::integer', ['CANARY_MIGRATION_PARAMETER']);
  }
  async down(): Promise<void> {}
}

export default source.setOptions({ migrations: [FailingProof1791800000001] });
