import { Global, Module } from '@nestjs/common';
import { ProviderAccessService } from './provider-access.service';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import {
  BusinessRegistrationStrategy,
  IndividualRegistrationStrategy,
  REGISTRATION_STRATEGIES,
} from './strategies/registration.strategy';

@Global()
@Module({
  controllers: [ProvidersController],
  providers: [
    ProvidersService,
    ProviderAccessService,
    BusinessRegistrationStrategy,
    IndividualRegistrationStrategy,
    {
      provide: REGISTRATION_STRATEGIES,
      useFactory: (b: BusinessRegistrationStrategy, i: IndividualRegistrationStrategy) => [b, i],
      inject: [BusinessRegistrationStrategy, IndividualRegistrationStrategy],
    },
  ],
  exports: [ProviderAccessService, ProvidersService],
})
export class ProvidersModule {}
