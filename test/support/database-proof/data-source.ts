import source from '@infrastructure/database/data-source.js';
import { ProofEntity } from './proof.entity.js';
import { ProofMigration1791800000000 } from './proof.migration.js';

export default source.setOptions({
  entities: [ProofEntity],
  migrations: [ProofMigration1791800000000],
});
