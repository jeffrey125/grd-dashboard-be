import {
  Column,
  Generated,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  ForeignKey,
  Check,
} from 'typeorm';

@Entity('auth_users')
@Index('uq_auth_users_external', ['externalId'], { unique: true })
@Index('uq_auth_users_email', ['email'], { unique: true })
@Index('ix_auth_users_created_by', ['createdById'])
@Index('ix_auth_users_updated_by', ['updatedById'])
@ForeignKey('AuthUserEntity', ['createdById'], ['id'], {
  name: 'fk_auth_users_creator',
  onDelete: 'NO ACTION',
})
@ForeignKey('AuthUserEntity', ['updatedById'], ['id'], {
  name: 'fk_auth_users_updater',
  onDelete: 'NO ACTION',
})
@Check('ck_auth_users_role', "role IN ('admin', 'staff')")
@Check('ck_auth_users_email', 'email = lower(btrim(email))')
@Check(
  'ck_auth_users_names',
  'length(btrim(first_name)) > 0 AND length(btrim(last_name)) > 0',
)
export class AuthUserEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'integer',
    generatedIdentity: 'ALWAYS',
  })
  id: number;
  @Column({
    name: 'external_id',
    type: 'uuid',
    default: () => 'gen_random_uuid()',
    update: false,
    insert: false,
  })
  @Generated('uuid')
  externalId: string;
  @Column({ name: 'name', type: 'text' })
  name: string;
  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;
  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;
  @Column({ name: 'email', type: 'varchar', length: 254 })
  email: string;
  @Column({ name: 'email_verified', type: 'boolean', default: () => 'false' })
  emailVerified: boolean;
  @Column({ name: 'image', type: 'text', nullable: true })
  image: string | null;
  @Column({
    name: 'role',
    type: 'varchar',
    length: 5,
    default: () => "'staff'",
  })
  role: 'admin' | 'staff';
  @Column({ name: 'active', type: 'boolean', default: () => 'true' })
  active: boolean;
  @Column({
    name: 'must_change_password',
    type: 'boolean',
    default: () => 'true',
  })
  mustChangePassword: boolean;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
  @Column({ name: 'created_by_id', type: 'integer', nullable: true })
  createdById: number | null;
  @Column({ name: 'updated_by_id', type: 'integer', nullable: true })
  updatedById: number | null;
}
