import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty() @IsUUID() vehicleId: string;
  @ApiProperty({ example: '2026-11-20T10:00:00Z' }) @IsDateString() startAt: string;
  @ApiProperty({ example: '2026-11-21T10:00:00Z' }) @IsDateString() endAt: string;
}

export class ProviderBookingsQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus }) @IsOptional() @IsEnum(BookingStatus) status?: BookingStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vehicleId?: string;
}
