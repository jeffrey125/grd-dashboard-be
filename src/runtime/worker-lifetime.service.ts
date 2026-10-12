import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

@Injectable()
export class WorkerLifetimeService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private keepAlive: ReturnType<typeof setInterval> | undefined;

  onApplicationBootstrap() {
    // A standalone Nest context has no server handle. Keep the idle worker alive
    // until shutdown; this timer performs no polling or application work.
    this.keepAlive = setInterval(() => {}, 2 ** 30);
  }

  onModuleDestroy() {
    clearInterval(this.keepAlive);
    this.keepAlive = undefined;
  }
}
