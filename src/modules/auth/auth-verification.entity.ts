import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('auth_verifications')
@Index('ix_auth_verifications_identifier', ['identifier'])
@Index('ix_auth_verifications_expires', ['expiresAt'])
export class AuthVerificationEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'integer',
    generatedIdentity: 'ALWAYS',
  })
  id: number;
  @Column({ name: 'identifier', type: 'text' })
  identifier: string;
  @Column({ name: 'value', type: 'text' })
  value: string;
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
