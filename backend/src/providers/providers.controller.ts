import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { AddMemberDto, CreateProviderDto } from './dto';
import { ProvidersService } from './providers.service';

@ApiTags('providers')
@ApiBearerAuth()
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @ApiOperation({ summary: 'Регистрация арендодателя (BUSINESS). Статус PENDING до проверки админом' })
  register(@CurrentUser() user: AuthUser, @Body() dto: CreateProviderDto) {
    return this.providers.register(user, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Арендодатели, в которых состоит текущий пользователь' })
  my(@CurrentUser() user: AuthUser) {
    return this.providers.my(user);
  }

  @Public()
  @Get(':id/public')
  @ApiOperation({ summary: 'Публичная карточка арендодателя' })
  publicCard(@Param('id', ParseUUIDPipe) id: string) {
    return this.providers.publicCard(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Полные данные арендодателя (для сотрудников)' })
  details(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.providers.details(user, id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Добавить сотрудника (только OWNER)' })
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.providers.addMember(user, id, dto);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Удалить сотрудника (только OWNER)' })
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.providers.removeMember(user, id, userId);
  }
}
