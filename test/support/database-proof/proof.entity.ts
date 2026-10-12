import { Column, Entity } from 'typeorm';
import { ExternallyIdentifiedEntity } from '@infrastructure/database/entities/externally-identified.entity.js';

// Temporary V1-004 proof: V1-005 replaces this entire fixture directory.
@Entity('repository_proof')
export class ProofEntity extends ExternallyIdentifiedEntity {
  @Column({ type: 'varchar', length: 100 })
  label: string;
}
