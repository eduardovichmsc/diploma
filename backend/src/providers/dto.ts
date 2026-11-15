import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberRole, ProviderType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class BusinessProfileDto {
  @ApiProperty({ example: 'ООО «АвтоПрокат Плюс»' })
  @IsString()
  @MinLength(2)
  legalName: string;

  @ApiProperty({ example: '7701234567', description: 'ИНН / БИН: 10–12 цифр' })
  @Matches(/^\d{10,12}$/, { message: 'taxId должен содержать 10–12 цифр' })
  taxId: string;

  @ApiProperty({ example: 'г. Москва, ул. Примерная, д. 1' })
  @IsString()
  legalAddress: string;

  @ApiProperty({ example: '40702810000000000001' })
  @IsString()
  bankAccount: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string;
}

export class CreateProviderDto {
  @ApiProperty({ enum: ProviderType, example: ProviderType.BUSINESS })
  @IsEnum(ProviderType)
  type: ProviderType;

  @ApiProperty({ example: 'АвтоПрокат Плюс' })
  @IsString()
  @MinLength(2)
  displayName: string;

  @ApiPropertyOptional({ type: BusinessProfileDto, description: 'Обязательно для type = BUSINESS' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BusinessProfileDto)
  business?: BusinessProfileDto;
}

export class AddMemberDto {
  @ApiProperty({ description: 'Email зарегистрированного пользователя' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: MemberRole })
  @IsEnum(MemberRole)
  role: MemberRole;
}
