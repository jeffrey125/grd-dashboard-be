import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';

export interface ReadinessDependency {
  // Use fixed, non-sensitive names; never names derived from configuration.
  name: string;
  check(signal: AbortSignal): void | Promise<void>;
}

export const READINESS_DEPENDENCIES = Symbol('READINESS_DEPENDENCIES');

@Injectable()
export class ReadinessService
  implements
    OnApplicationBootstrap,
    BeforeApplicationShutdown,
    OnApplicationShutdown
{
  private ready = false;

  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(HealthIndicatorService)
    private readonly indicators: HealthIndicatorService,
    @Inject(READINESS_DEPENDENCIES)
    private readonly dependencies: readonly ReadinessDependency[],
  ) {}

  onApplicationBootstrap() {
    this.ready = true;
  }
  beforeApplicationShutdown() {
    this.ready = false;
  }
  onApplicationShutdown() {
    console.info('Application stopped');
  }

  check() {
    return this.health.check([
      () =>
        this.ready
          ? this.indicators.check('application').up()
          : this.indicators.check('application').down(),
      ...this.dependencies.map((dependency) => async () => {
        const indicator = this.indicators.check(dependency.name);
        const result = await indicator
          .attempt(async ({ signal }) => {
            await dependency.check(signal);
          })
          .withTimeout(1000);
        // Terminus can include the thrown error's message. Expose status only.
        return result[dependency.name].status === 'up'
          ? indicator.up()
          : indicator.down();
      }),
    ]);
  }
}
