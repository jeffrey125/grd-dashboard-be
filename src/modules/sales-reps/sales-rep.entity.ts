import { Check, Column, Entity, ForeignKey, Index } from 'typeorm';
import { ExternallyIdentifiedEntity } from '@infrastructure/database/entities/externally-identified.entity.js';

@Entity('sales_reps')
@Check(
  'ck_sales_reps_names',
  'length(btrim(first_name)) > 0 AND length(btrim(last_name)) > 0',
)
@ForeignKey('AuthUserEntity', ['createdById'], ['id'], {
  name: 'fk_sales_reps_created_by_id',
  onDelete: 'NO ACTION',
})
@Index('ix_sales_reps_created_by_id', ['createdById'])
@ForeignKey('AuthUserEntity', ['updatedById'], ['id'], {
  name: 'fk_sales_reps_updated_by_id',
  onDelete: 'NO ACTION',
})
@Index('ix_sales_reps_updated_by_id', ['updatedById'])
@ForeignKey('AuthUserEntity', ['deletedById'], ['id'], {
  name: 'fk_sales_reps_deleted_by_id',
  onDelete: 'NO ACTION',
})
@Index('ix_sales_reps_deleted_by_id', ['deletedById'])
@Index('ix_sales_reps_name', ['lastName', 'firstName', 'id'])
export class SalesRepEntity extends ExternallyIdentifiedEntity {
  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;
}
