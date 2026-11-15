import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import {
  CatalogQueryDto,
  CreateVehicleDto,
  TariffDto,
  TimeRangeQueryDto,
  UpdateVehicleDto,
  VehicleCommandDto,
} from './dto';
import { VehiclesService } from './vehicles.service';

@ApiTags('vehicles')
@ApiBearerAuth()
@Controller()
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Public()
  @Get('vehicles')
  @ApiOperation({ summary: 'Каталог: поиск свободных машин с фильтрами' })
  catalog(@Query() q: CatalogQueryDto) {
    return this.vehicles.catalog(q);
  }

  @Public()
  @Get('vehicles/:id')
  @ApiOperation({ summary: 'Карточка машины с тарифом и занятыми интервалами' })
  card(@Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.publicCard(id);
  }

  @Post('providers/:providerId/vehicles')
  @ApiOperation({ summary: 'Добавить машину в автопарк (с тарифом)' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Body() dto: CreateVehicleDto,
  ) {
    return this.vehicles.create(user, providerId, dto);
  }

  @Get('providers/:providerId/vehicles')
  @ApiOperation({ summary: 'Автопарк арендодателя: модули, последняя телеметрия, ошибки, ближайшие брони' })
  fleet(@CurrentUser() user: AuthUser, @Param('providerId', ParseUUIDPipe) providerId: string) {
    return this.vehicles.providerFleet(user, providerId);
  }

  @Patch('vehicles/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehicles.update(user, id, dto);
  }

  @Put('vehicles/:id/tariff')
  setTariff(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TariffDto,
  ) {
    return this.vehicles.setTariff(user, id, dto);
  }

  @Get('vehicles/:id/telemetry')
  @ApiOperation({ summary: 'История телеметрии машины' })
  telemetry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: TimeRangeQueryDto,
  ) {
    return this.vehicles.telemetry(user, id, q);
  }

  @Get('vehicles/:id/events')
  @ApiOperation({ summary: 'События модуля: запуск, резкие манёвры, ошибки' })
  events(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: TimeRangeQueryDto,
  ) {
    return this.vehicles.events(user, id, q);
  }

  @Get('vehicles/:id/dtc')
  @ApiOperation({ summary: 'Коды неисправностей (DTC)' })
  dtc(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.dtc(user, id);
  }

  @Post('vehicles/:id/dtc/:dtcId/resolve')
  @HttpCode(200)
  resolveDtc(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dtcId', ParseUUIDPipe) dtcId: string,
  ) {
    return this.vehicles.resolveDtc(user, id, dtcId);
  }

  @Post('vehicles/:id/command')
  @HttpCode(200)
  @ApiOperation({ summary: 'Команда модулю: открыть или закрыть машину' })
  command(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VehicleCommandDto,
  ) {
    return this.vehicles.command(user, id, dto);
  }
}
