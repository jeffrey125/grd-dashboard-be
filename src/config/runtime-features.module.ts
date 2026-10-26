import {
  type CanActivate,
  Inject,
  Injectable,
  Module,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RuntimeConfigModule } from './config.module.js';
import type { RuntimeConfiguration } from './configuration.js';

@Injectable()
export class RuntimeFeatures {
  readonly quoteComparisonEnabled: boolean;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.quoteComparisonEnabled =
      config.getOrThrow<RuntimeConfiguration>('runtime').quoteComparisonEnabled;
  }
}

@Injectable()
export class QuoteComparisonGuard implements CanActivate {
  constructor(
    @Inject(RuntimeFeatures) private readonly features: RuntimeFeatures,
  ) {}

  canActivate() {
    if (!this.features.quoteComparisonEnabled) throw new NotFoundException();
    return true;
  }
}

@Module({
  imports: [RuntimeConfigModule],
  providers: [RuntimeFeatures, QuoteComparisonGuard],
  exports: [RuntimeFeatures, QuoteComparisonGuard],
})
export class RuntimeFeaturesModule {}
