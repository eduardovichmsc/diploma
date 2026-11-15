import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators';
import { MqttService } from './mqtt/mqtt.service';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
  ) {}

  @Public()
  @Get()
  async check() {
    let db = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    return { status: 'ok', db, mqtt: this.mqtt.isConnected() ? 'ok' : 'down', time: new Date() };
  }
}
