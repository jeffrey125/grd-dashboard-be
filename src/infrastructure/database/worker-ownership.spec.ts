import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfiguration } from '@config/configuration.js';
import { testEnvironment } from '@test/support/environment.js';
import { WorkerOwnership } from './worker-ownership.js';

const clients = vi.hoisted(() => [] as EventEmitter[]);

vi.mock('pg', () => ({
  default: {
    Client: class extends EventEmitter {
      connect = vi.fn().mockResolvedValue(undefined);
      query = vi
        .fn()
        .mockResolvedValue({ rows: [{ acquired: true, held: true }] });
      end = vi.fn().mockImplementation(async () => {
        this.emit('end');
      });
      constructor() {
        super();
        clients.push(this);
      }
    },
  },
}));

function client() {
  return clients.at(-1)! as EventEmitter & { query: ReturnType<typeof vi.fn> };
}

describe('worker ownership failure handling', () => {
  afterEach(() => {
    clients.length = 0;
    vi.useRealTimers();
  });

  it('fails closed when a heartbeat fails and ignores duplicate disconnect events', async () => {
    vi.useFakeTimers();
    const lost = vi.fn();
    const owner = new WorkerOwnership(
      createConfiguration(testEnvironment).database,
      lost,
    );
    await owner.acquire(new AbortController().signal, vi.fn());
    client().query.mockRejectedValueOnce(new Error('fixture query timeout'));
    await vi.advanceTimersByTimeAsync(2000);
    client().emit('error', new Error('fixture disconnect'));
    client().emit('end');
    expect(lost).toHaveBeenCalledTimes(1);
    await owner.close();
  });

  it('detects a missing lock even when the database session responds', async () => {
    vi.useFakeTimers();
    const lost = vi.fn();
    const owner = new WorkerOwnership(
      createConfiguration(testEnvironment).database,
      lost,
    );
    await owner.acquire(new AbortController().signal, vi.fn());
    client().query.mockResolvedValueOnce({ rows: [{ held: false }] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(lost).toHaveBeenCalledTimes(1);
    await owner.close();
  });

  it('does not report planned close as loss or allow an already-aborted startup', async () => {
    const lost = vi.fn();
    const owner = new WorkerOwnership(
      createConfiguration(testEnvironment).database,
      lost,
    );
    const abort = new AbortController();
    abort.abort();
    await expect(owner.acquire(abort.signal, vi.fn())).rejects.toThrow();
    await owner.close();
    expect(lost).not.toHaveBeenCalled();
  });
});
