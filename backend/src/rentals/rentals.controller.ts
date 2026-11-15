import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ReviewDto, StartRentalDto } from './dto';
import { RentalsService } from './rentals.service';

@ApiTags('rentals')
@ApiBearerAuth()
@Controller('rentals')
export class RentalsController {
  constructor(private readonly rentals: RentalsService) {}

  @Post('start')
  @ApiOperation({ summary: 'Начать аренду: модуль открывает машину и фиксирует стартовые показания' })
  start(@CurrentUser() user: AuthUser, @Body() dto: StartRentalDto) {
    return this.rentals.start(user, dto.bookingId);
  }

  @Post(':id/finish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Завершить аренду: модуль закрывает машину, сервер считает итог' })
  finish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rentals.finish(user, id);
  }

  @Get('active')
  @ApiOperation({ summary: 'Текущая активная аренда пользователя' })
  active(@CurrentUser() user: AuthUser) {
    return this.rentals.active(user);
  }

  @Get('my')
  @ApiOperation({ summary: 'История поездок пользователя' })
  my(@CurrentUser() user: AuthUser) {
    return this.rentals.my(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rentals.get(user, id);
  }

  @Get(':id/track')
  @ApiOperation({ summary: 'Трек поездки (точки GPS)' })
  track(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rentals.track(user, id);
  }

  @Get(':id/events')
  events(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rentals.events(user, id);
  }

  @Post(':id/review')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.rentals.review(user, id, dto);
  }
}
