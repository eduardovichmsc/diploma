import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators';
import { BookingsService } from './bookings.service';
import { CreateBookingDto, ProviderBookingsQueryDto } from './dto';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('bookings')
  @ApiOperation({ summary: 'Забронировать машину (статус PENDING_PAYMENT, 15 минут на оплату)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user, dto);
  }

  @Get('bookings/my')
  my(@CurrentUser() user: AuthUser) {
    return this.bookings.my(user);
  }

  @Get('bookings/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.get(user, id);
  }

  @Post('bookings/:id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Оплатить депозит (mock-платёж) → CONFIRMED' })
  pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.pay(user, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.cancel(user, id);
  }

  @Get('providers/:providerId/bookings')
  @ApiOperation({ summary: 'Брони автопарка арендодателя' })
  providerBookings(
    @CurrentUser() user: AuthUser,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Query() q: ProviderBookingsQueryDto,
  ) {
    return this.bookings.providerBookings(user, providerId, q);
  }
}
