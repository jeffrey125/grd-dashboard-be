import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  ForeignKey,
} from 'typeorm';

@Entity('auth_sessions')
@Index('uq_auth_sessions_token', ['token'], { unique: true })
@Index('ix_auth_sessions_user', ['userId'])
@Index('ix_auth_sessions_expires', ['expiresAt'])
@ForeignKey('AuthUserEntity', ['userId'], ['id'], {
  name: 'fk_auth_sessions_user',
  onDelete: 'NO ACTION',
})
export class AuthSessionEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'integer',
    generatedIdentity: 'ALWAYS',
  })
  id: number;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @Column({ name: 'token', type: 'text' })
  token: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'ip_address', type: 'text', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
