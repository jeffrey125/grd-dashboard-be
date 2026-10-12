import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseReadiness {
  private pending?: Promise<void>;
  constructor(@Inject(DataSource) private readonly source: DataSource) {}

  check(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    // Terminus bounds the response to one second. Driver acquisition/query
    // timeouts bound the underlying I/O; coalesce probes while one is pending.
    this.pending ??= this.source
      .query('SELECT 1')
      .then(() => undefined)
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
}
