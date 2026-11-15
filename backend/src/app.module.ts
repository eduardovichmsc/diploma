import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { DevicesModule } from './devices/devices.module';
import { HealthController } from './health.controller';
import { LiveModule } from './live/live.module';
import { MqttModule } from './mqtt/mqtt.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvidersModule } from './providers/providers.module';
import { RentalsModule } from './rentals/rentals.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { UsersModule } from './users/users.module';
import { VehiclesModule } from './vehicles/vehicles.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MqttModule,
    LiveModule,
    AuthModule,
    UsersModule,
    ProvidersModule,
    VehiclesModule,
    BookingsModule,
    RentalsModule,
    DevicesModule,
    TelemetryModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
