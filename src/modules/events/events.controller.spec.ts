import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthService } from '@modules/auth/auth.service.js';
import { EventsController } from './events.controller.js';
import type { EventsSource, LiveEvent } from './events.source.js';

describe('SSE bounded delivery and fresh authorization', () => {
  const responses: EventEmitter[] = [];

  afterEach(() => {
    for (const response of responses.splice(0)) response.emit('close');
  });

  function stream(writableLength = 0) {
    const response = Object.assign(new EventEmitter(), {
      set: vi.fn(),
      flushHeaders: vi.fn(),
      end: vi.fn(),
      write: vi.fn(),
      writableLength,
    });
    responses.push(response);
    const events = new Subject<LiveEvent>();
    const authenticate = vi
      .fn()
      .mockResolvedValue({ role: 'staff', mustChangePassword: false });
    const controller = new EventsController(
      { events, start: vi.fn() } as unknown as EventsSource,
      { authenticate } as unknown as AuthService,
    );
    controller.stream(
      { headers: {} } as Request,
      response as unknown as Response,
    );

    return { events, authenticate, response };
  }

  it.each([
    { role: 'staff', mustChangePassword: true },
    { role: 'unsupported', mustChangePassword: false },
  ])(
    'closes when fresh authorization restricts the session: %j',
    async (principal) => {
      const { events, authenticate, response } = stream();
      await vi.waitFor(() => expect(response.write).toHaveBeenCalledOnce());
      authenticate.mockResolvedValue(principal);
      events.next({ type: 'shipment.changed', externalId: 'public-id' });
      await vi.waitFor(() => expect(response.end).toHaveBeenCalledOnce());
      expect(response.write).toHaveBeenCalledOnce();
      expect(events.observed).toBe(false);
    },
  );

  it('closes a connection whose output buffer is already full', () => {
    const { events, response, authenticate } = stream(65_537);
    expect(response.end).toHaveBeenCalledOnce();
    expect(response.write).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
    expect(events.observed).toBe(false);
  });

  it('bounds queued events while authorization is slow and ignores late completion', async () => {
    const { events, response, authenticate } = stream();
    let resolve!: (value: unknown) => void;
    authenticate.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledOnce());
    for (let count = 0; count < 101; count++) events.next({ type: 'resync' });
    expect(response.end).toHaveBeenCalledOnce();
    expect(events.observed).toBe(false);
    resolve({ role: 'staff', mustChangePassword: false });
    await Promise.resolve();
    expect(response.write).not.toHaveBeenCalled();
  });
});
