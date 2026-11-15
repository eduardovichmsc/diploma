import {
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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { BookingStatus, PlatformRole, ProviderStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { Roles } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

export class ProvidersQueryDto {
  @ApiPropertyOptional({ enum: ProviderStatus })
  @IsOptional()
  @IsEnum(ProviderStatus)
  status?: ProviderStatus;
}

/** Допустимые переходы статуса арендодателя (диаграмма состояний 10). */
const TRANSITIONS: Record<string, { from: ProviderStatus[]; to: ProviderStatus }> = {
  approve: { from: [ProviderStatus.PENDING], to: ProviderStatus.ACTIVE },
  reject: { from: [ProviderStatus.PENDING], to: ProviderStatus.REJECTED },
  block: { from: [ProviderStatus.ACTIVE], to: ProviderStatus.BLOCKED },
  unblock: { from: [ProviderStatus.BLOCKED], to: ProviderStatus.ACTIVE },
};

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  providers(status?: ProviderStatus) {
    return this.prisma.rentalProvider.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      include: {
        business: true,
        members: { include: { user: { select: { id: true, email: true, fullName: true } } } },
        _count: { select: { vehicles: true } },
      },
    });
  }

  async transition(id: string, action: keyof typeof TRANSITIONS) {
    const t = TRANSITIONS[action];
    const p = await this.prisma.rentalProvider.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Арендодатель не найден');
    if (!t.from.includes(p.status)) {
      throw new ConflictException(`Действие ${action} недоступно из статуса ${p.status}`);
    }
    return this.prisma.rentalProvider.update({ where: { id }, data: { status: t.to } });
  }

  users() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, fullName: true, phone: true, role: true, createdAt: true },
    });
  }

  async stats() {
    const [users, providers, vehicles, devices, devicesOnline, bookingsByStatus, revenue] =
      await this.prisma.$transaction([
        this.prisma.user.count(),
        this.prisma.rentalProvider.groupBy({
          by: ['status'],
          _count: { _all: true },
          orderBy: { status: 'asc' },
        }),
        this.prisma.vehicle.count(),
        this.prisma.device.count(),
        this.prisma.device.count({ where: { online: true } }),
        this.prisma.booking.groupBy({
          by: ['status'],
          _count: { _all: true },
          orderBy: { status: 'asc' },
        }),
        this.prisma.rental.aggregate({ _sum: { totalPrice: true }, where: { finishedAt: { not: null } } }),
      ]);
    return {
      users,
      providers: Object.fromEntries(providers.map((p) => [p.status, (p._count as { _all: number })._all])),
      vehicles,
      devices: { total: devices, online: devicesOnline },
      bookings: Object.fromEntries(
        bookingsByStatus.map((b) => [b.status, (b._count as { _all: number })._all]),
      ) as Partial<Record<BookingStatus, number>>,
      revenue: revenue._sum.totalPrice ?? 0,
    };
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(PlatformRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('providers')
  @ApiOperation({ summary: 'Арендодатели (фильтр по статусу, например PENDING)' })
  providers(@Query() q: ProvidersQueryDto) {
    return this.admin.providers(q.status);
  }

  @Post('providers/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.transition(id, 'approve');
  }

  @Post('providers/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.transition(id, 'reject');
  }

  @Post('providers/:id/block')
  @HttpCode(200)
  block(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.transition(id, 'block');
  }

  @Post('providers/:id/unblock')
  @HttpCode(200)
  unblock(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.transition(id, 'unblock');
  }

  @Get('users')
  users() {
    return this.admin.users();
  }

  @Get('stats')
  @ApiOperation({ summary: 'Статистика платформы' })
  stats() {
    return this.admin.stats();
  }
}

@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
