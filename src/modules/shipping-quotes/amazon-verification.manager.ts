import { randomUUID } from 'node:crypto';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { AmazonAccountAccess } from './amazon-account-access.js';
import type { VerificationBrowser } from './amazon-verification.browser.js';
import {
  VerificationError,
  type VerificationCommand,
  type VerificationView,
} from './amazon-verification.contract.js';

type Session = {
  id: string;
  owner: string;
  actorExternalId: string;
  comparisonId: string;
  attemptId: string;
  expires: number;
  touched: number;
  state: VerificationView['state'];
  browser: VerificationBrowser;
  release: () => void;
  error?: VerificationError;
  busy: boolean;
};

/** Ephemeral human interaction, independent of the 90-second quote execution lease. */
export class AmazonVerificationManager {
  private session?: Session;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly access: AmazonAccountAccess,
    private readonly factory: () => VerificationBrowser,
    private readonly logger: ProjectLogger,
    private readonly now = Date.now,
  ) {
    this.timer = setInterval(() => {
      void this.expire().catch(() => undefined);
    }, 1000);
    this.timer.unref();
  }

  private view(session: Session): VerificationView {
    return {
      id: session.id,
      state: session.state,
      expiresAt: new Date(session.expires).toISOString(),
    };
  }

  private audit(session: Session, outcome: string) {
    this.logger.info(
      'amazon.verification',
      'Staff Amazon verification state changed',
      { actorExternalId: session.actorExternalId, outcome },
    );
  }

  private async end(session: Session, outcome: string) {
    if (this.session === session) this.session = undefined;
    try {
      await session.browser.close().catch(() => undefined);
    } finally {
      session.release();
      this.audit(session, outcome);
    }
  }

  async expire() {
    const session = this.session;
    if (
      session &&
      (this.now() >= session.expires || this.now() - session.touched > 60_000)
    )
      await this.end(session, 'expired');
  }

  async command(command: VerificationCommand): Promise<VerificationView> {
    await this.expire();
    let session = this.session;
    if (command.operation === 'start') {
      if (session) {
        if (
          session.owner !== command.owner ||
          session.comparisonId !== command.comparisonId ||
          session.attemptId !== command.attemptId
        )
          throw new VerificationError('busy');
        session.touched = this.now();
        return this.view(session);
      }
      const release = this.access.acquire();
      let browser: VerificationBrowser;
      try {
        browser = this.factory();
      } catch (error) {
        release();
        throw error;
      }
      session = {
        ...command,
        id: randomUUID(),
        expires: this.now() + 10 * 60_000,
        touched: this.now(),
        state: 'preparing',
        browser,
        release,
        busy: true,
      };
      this.session = session;
      this.audit(session, 'started');
      const current = session;
      void current.browser
        .start()
        .then(() => {
          if (this.session === current) current.state = 'challenge';
        })
        .catch(() => {
          current.error = new VerificationError('unsupported');
        })
        .finally(() => {
          current.busy = false;
        });
      return this.view(session);
    }
    if (!session || session.id !== command.id)
      throw new VerificationError('expired');
    if (
      session.owner !== command.owner ||
      session.comparisonId !== command.comparisonId ||
      session.attemptId !== command.attemptId
    )
      throw new VerificationError('owner_required');
    session.touched = this.now();
    if (command.operation === 'cancel') {
      await this.end(session, 'cancelled');
      return { ...this.view(session), state: 'cancelled' };
    }
    if (session.error) {
      await this.end(session, 'failed');
      throw session.error;
    }
    if (session.state === 'verified') return this.view(session);
    if (session.busy) {
      if (command.operation === 'action') throw new VerificationError('busy');
      return { ...this.view(session), state: 'preparing' };
    }
    session.busy = true;
    try {
      if (command.operation === 'action') {
        await session.browser.act(command.action);
        // Let provider navigation settle before taking the next frame. Never replay an input.
        return { ...this.view(session), state: 'preparing' };
      }
      const result = await session.browser.view();
      if (this.session !== session) throw new VerificationError('expired');
      if (result.verified) {
        await session.browser.save();
        if (this.session !== session) throw new VerificationError('expired');
        session.state = 'verified';
        await session.browser.close();
        session.release();
        this.audit(session, 'verified');
        return this.view(session);
      }
      if ('preparing' in result)
        return { ...this.view(session), state: 'preparing' };
      return {
        ...this.view(session),
        image: result.image,
        frame: result.frame,
        width: result.width,
        height: result.height,
      };
    } catch (error) {
      if (error instanceof VerificationError && error.code === 'stale_frame')
        throw error;
      await this.end(session, 'failed');
      throw error instanceof VerificationError
        ? error
        : new VerificationError('unsupported');
    } finally {
      session.busy = false;
    }
  }

  async close() {
    clearInterval(this.timer);
    if (this.session) await this.end(this.session, 'shutdown');
  }
}
