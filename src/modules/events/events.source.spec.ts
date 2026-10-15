import { describe, expect, it } from 'vitest';
import { changeSchema } from './events.source.js';

describe('live event validation', () => {
  it('parses PostgreSQL tracking timestamps into instants', () => {
    expect(
      changeSchema.parse({
        type: 'tracking.changed',
        externalId: '8c70a1c2-1ba2-4b85-a973-97ca73c676e4',
        snapshotExternalId: 'aa920a20-af06-46cd-bb22-4596857bcb20',
        observedAt: '2026-10-16T08:00:00+08:00',
      }),
    ).toEqual({
      type: 'tracking.changed',
      externalId: '8c70a1c2-1ba2-4b85-a973-97ca73c676e4',
      snapshotExternalId: 'aa920a20-af06-46cd-bb22-4596857bcb20',
      observedAt: new Date('2026-10-16T00:00:00.000Z'),
    });
  });

  it.each([
    {
      type: 'tracking.changed',
      externalId: '8c70a1c2-1ba2-4b85-a973-97ca73c676e4',
      snapshotExternalId: 'internal-id',
      observedAt: '2026-10-16T00:00:00Z',
    },
    {
      type: 'tracking.changed',
      externalId: '8c70a1c2-1ba2-4b85-a973-97ca73c676e4',
      snapshotExternalId: 'aa920a20-af06-46cd-bb22-4596857bcb20',
      observedAt: 'today',
    },
    {
      type: 'tracking.changed',
      externalId: '8c70a1c2-1ba2-4b85-a973-97ca73c676e4',
      snapshotExternalId: 'aa920a20-af06-46cd-bb22-4596857bcb20',
      observedAt: '2026-10-16T00:00:00Z',
      shipmentId: 42,
    },
  ])('rejects malformed or internal tracking event fields', (event) => {
    expect(changeSchema.safeParse(event).success).toBe(false);
  });
});
