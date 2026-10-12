import { Column, Generated } from 'typeorm';
import { AuditableEntity } from './auditable.entity.js';

export abstract class ExternallyIdentifiedEntity extends AuditableEntity {
  // Reviewed migrations must also reject identifier updates at the DB boundary.
  @Column({
    name: 'external_id',
    type: 'uuid',
    unique: true,
    default: () => 'gen_random_uuid()',
    insert: false,
    update: false,
  })
  @Generated('uuid')
  readonly externalId: string;
}
