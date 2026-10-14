import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  ForeignKey,
} from 'typeorm';

@Entity('auth_accounts')
@Index('uq_auth_accounts_provider', ['providerId', 'accountId'], {
  unique: true,
})
@Index('ix_auth_accounts_user', ['userId'])
@ForeignKey('AuthUserEntity', ['userId'], ['id'], {
  name: 'fk_auth_accounts_user',
  onDelete: 'NO ACTION',
})
export class AuthAccountEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'integer',
    generatedIdentity: 'ALWAYS',
  })
  id: number;
  @Column({ name: 'user_id', type: 'integer' })
  userId: number;
  @Column({ name: 'account_id', type: 'text' })
  accountId: string;
  @Column({ name: 'provider_id', type: 'text' })
  providerId: string;
  @Column({ name: 'password', type: 'text', nullable: true })
  password: string | null;
  @Column({ name: 'access_token', type: 'text', nullable: true })
  accessToken: string | null;
  @Column({ name: 'refresh_token', type: 'text', nullable: true })
  refreshToken: string | null;
  @Column({ name: 'id_token', type: 'text', nullable: true })
  idToken: string | null;
  @Column({ name: 'scope', type: 'text', nullable: true })
  scope: string | null;
  @Column({
    name: 'access_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  accessTokenExpiresAt: Date | null;
  @Column({
    name: 'refresh_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  refreshTokenExpiresAt: Date | null;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
