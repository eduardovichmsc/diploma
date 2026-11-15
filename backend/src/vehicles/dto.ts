import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { FuelType, Transmission, VehicleStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class TariffDto {
  @ApiProperty({ example: 900 }) @IsNumber() @Min(0) pricePerHour: number;
  @ApiProperty({ example: 6500 }) @IsNumber() @Min(0) pricePerDay: number;
  @ApiProperty({ example: 250 }) @IsInt() @Min(0) kmLimitPerDay: number;
  @ApiProperty({ example: 15, description: 'Цена за 1 км сверх лимита' })
  @IsNumber() @Min(0) overmileagePrice: number;
  @ApiProperty({ example: 60, description: 'Цена за 1 % недолива топлива' })
  @IsNumber() @Min(0) fuelPricePerPercent: number;
  @ApiProperty({ example: 10000 }) @IsNumber() @Min(0) deposit: number;
}

export class CreateVehicleDto {
  @ApiProperty({ example: 'Toyota' }) @IsString() @MinLength(1) brand: string;
  @ApiProperty({ example: 'Camry' }) @IsString() @MinLength(1) model: string;
  @ApiProperty({ example: 2022 }) @IsInt() @Min(1990) @Max(2100) year: number;
  @ApiProperty({ example: 'А123ВС777' }) @IsString() @MinLength(4) plateNumber: string;

  @ApiProperty({ example: 'JTNB11HK103456789' })
  @Matches(/^[A-HJ-NPR-Z0-9]{17}$/, { message: 'VIN: 17 символов, латиница и цифры, без I, O, Q' })
  vin: string;

  @ApiProperty({ enum: Transmission }) @IsEnum(Transmission) transmission: Transmission;
  @ApiProperty({ enum: FuelType }) @IsEnum(FuelType) fuelType: FuelType;
  @ApiProperty({ example: 5 }) @IsInt() @Min(1) @Max(9) seats: number;
  @ApiProperty({ example: 'Москва' }) @IsString() city: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  photoUrls?: string[];

  @ApiProperty({ type: TariffDto })
  @ValidateNested() @Type(() => TariffDto)
  tariff: TariffDto;
}

export class UpdateVehicleDto extends PartialType(OmitType(CreateVehicleDto, ['tariff'] as const)) {
  @ApiPropertyOptional({ enum: [VehicleStatus.AVAILABLE, VehicleStatus.MAINTENANCE] })
  @IsOptional()
  @IsIn([VehicleStatus.AVAILABLE, VehicleStatus.MAINTENANCE])
  status?: VehicleStatus;
}

export class CatalogQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional({ description: 'Свободна с (ISO)' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ description: 'Свободна по (ISO)' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: Transmission }) @IsOptional() @IsEnum(Transmission) transmission?: Transmission;
  @ApiPropertyOptional({ enum: FuelType }) @IsOptional() @IsEnum(FuelType) fuelType?: FuelType;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() minPrice?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() maxPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class TimeRangeQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ default: 500 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000)
  limit = 500;
}

export class VehicleCommandDto {
  @ApiProperty({ enum: ['lock', 'unlock'] })
  @IsIn(['lock', 'unlock'])
  action: 'lock' | 'unlock';
}
