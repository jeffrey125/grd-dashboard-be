import {
  Check,
  Column,
  Entity,
  ForeignKey,
  PrimaryColumn,
  Index,
} from 'typeorm';

@Entity('upcoming_shipment_rep_access')
@ForeignKey('AuthUserEntity', ['accountId'], ['id'], {
  name: 'fk_upcoming_access_account',
  onDelete: 'NO ACTION',
})
@Index('uq_upcoming_access_own', ['accountId'], {
  unique: true,
  where: "kind = 'own'",
})
@Check('ck_upcoming_access_kind', "kind IN ('own', 'assigned')")
@Check('ck_upcoming_access_rep', "rep_id ~ '^rec[A-Za-z0-9]{14}$'")
export class UpcomingAccessEntity {
  @PrimaryColumn({
    name: 'account_id',
    type: 'integer',
    primaryKeyConstraintName: 'pk_upcoming_access',
  })
  accountId: number;

  @PrimaryColumn({
    name: 'rep_id',
    type: 'varchar',
    length: 17,
    primaryKeyConstraintName: 'pk_upcoming_access',
  })
  repId: string;

  @Column({ type: 'varchar', length: 8 })
  kind: 'own' | 'assigned';
}
