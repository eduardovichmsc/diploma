import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { PlatformRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { randomBytes } from 'crypto';
import { Roles } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryService } from '../telemetry/telemetry.service';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'ESP32-0004' })
  @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: 'serial: 3–40 символов, латиница, цифры, - и _' })
  serial: string;

  @ApiPropertyOptional({ example: '0.1.0' })
  @IsOptional()
  @IsString()
  firmwareVersion?: string;
}

export class BindDeviceDto {
  @ApiProperty() @IsUUID() vehicleId: string;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryService,
  ) {}

  list() {
    return this.prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        serial: true,
        firmwareVersion: true,
        online: true,
        lastSeenAt: true,
        createdAt: true,
        vehicle: {
          select: {
            id: true,
            brand: true,
            model: true,
            plateNumber: true,
            provider: { select: { id: true, displayName: true } },
          },
        },
      },
    });
  }

  /** Регистрирует модуль. Секрет возвращается один раз: он прошивается в устройство для авторизации на брокере. */
  async register(dto: RegisterDeviceDto) {
    const secret = randomBytes(16).toString('hex');
    try {
      const device = await this.prisma.device.create({
        data: {
          serial: dto.serial,
          firmwareVersion: dto.firmwareVersion,
          secretHash: await bcrypt.hash(secret, 10),
        },
        select: { id: true, serial: true, firmwareVersion: true, createdAt: true },
      });
      return { device, secret };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Модуль с таким серийным номером уже зарегистрирован');
      }
      throw e;
    }
  }

  async bind(id: string, vehicleId: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Модуль не найден');
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: { device: true },
    });
    if (!vehicle) throw new NotFoundException('Автомобиль не найден');
    if (vehicle.device && vehicle.device.id !== id) {
      throw new ConflictException(`На автомобиле уже установлен модуль ${vehicle.device.serial}`);
    }
    const res = await this.prisma.device.update({ where: { id }, data: { vehicleId } });
    this.telemetry.invalidate(device.serial);
    return res;
  }

  async unbind(id: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Модуль не найден');
    const res = await this.prisma.device.update({ where: { id }, data: { vehicleId: null } });
    this.telemetry.invalidate(device.serial);
    return res;
  }
}

@ApiTags('admin / devices')
@ApiBearerAuth()
@Roles(PlatformRole.ADMIN)
@Controller('admin/devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  list() {
    return this.devices.list();
  }

  @Post()
  @ApiOperation({ summary: 'Зарегистрировать модуль (секрет возвращается один раз)' })
  register(@Body() dto: RegisterDeviceDto) {
    return this.devices.register(dto);
  }

  @Post(':id/bind')
  @HttpCode(200)
  @ApiOperation({ summary: 'Привязать модуль к автомобилю' })
  bind(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BindDeviceDto) {
    return this.devices.bind(id, dto.vehicleId);
  }

  @Post(':id/unbind')
  @HttpCode(200)
  unbind(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.unbind(id);
  }
}

@Module({
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
