import { Controller, Get, Header, Inject, Module } from '@nestjs/common';
import { AuthPolicy } from '@modules/auth/auth.policy.js';
import {
  RuntimeFeatures,
  RuntimeFeaturesModule,
} from '@config/runtime-features.module.js';

@Controller('features')
@AuthPolicy('public')
export class RuntimeFeaturesController {
  constructor(
    @Inject(RuntimeFeatures) private readonly features: RuntimeFeatures,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get() {
    return { quoteComparisonEnabled: this.features.quoteComparisonEnabled };
  }
}

@Module({
  imports: [RuntimeFeaturesModule],
  controllers: [RuntimeFeaturesController],
})
export class RuntimeFeaturesHttpModule {}
