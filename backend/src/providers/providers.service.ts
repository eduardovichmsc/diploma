import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberRole, ProviderStatus, ProviderType } from '@prisma/client';
import { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AddMemberDto, CreateProviderDto } from './dto';
import { ProviderAccessService } from './provider-access.service';
import {
  ProviderRegistrationStrategy,
  REGISTRATION_STRATEGIES,
} from './strategies/registration.strategy';

@Injectable()
export class ProvidersService {
  private readonly strategies: Map<ProviderType, ProviderRegistrationStrategy>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProviderAccessService,
    @Inject(REGISTRATION_STRATEGIES) strategies: ProviderRegistrationStrategy[],
  ) {
    this.strategies = new Map(strategies.map((s) => [s.type, s]));
  }

  async register(user: AuthUser, dto: CreateProviderDto) {
    const strategy = this.strategies.get(dto.type);
    if (!strategy) throw new BadRequestException(`Тип арендодателя ${dto.type} не поддерживается`);
    const provider = await this.prisma.$transaction((tx) => strategy.register(tx, user.id, dto));
    return this.getFull(provider.id);
  }

  my(user: AuthUser) {
    return this.prisma.providerMember.findMany({
      where: { userId: user.id },
      select: {
        role: true,
        provider: { include: { business: true, _count: { select: { vehicles: true } } } },
      },
    });
  }

  /** Публичная карточка арендодателя (только активные). */
  async publicCard(id: string) {
    const p = await this.prisma.rentalProvider.findFirst({
      where: { id, status: ProviderStatus.ACTIVE },
      select: {
        id: true,
        type: true,
        displayName: true,
        rating: true,
        createdAt: true,
        _count: { select: { vehicles: true } },
      },
    });
    if (!p) throw new NotFoundException('Арендодатель не найден');
    return p;
  }

  async details(user: AuthUser, id: string) {
    await this.access.assertMember(user, id);
    return this.getFull(id);
  }

  private getFull(id: string) {
    return this.prisma.rentalProvider.findUniqueOrThrow({
      where: { id },
      include: {
        business: true,
        members: { include: { user: { select: { id: true, email: true, fullName: true } } } },
        _count: { select: { vehicles: true } },
      },
    });
  }

  async addMember(user: AuthUser, providerId: string, dto: AddMemberDto) {
    await this.access.assertMember(user, providerId, [MemberRole.OWNER]);
    const target = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!target) throw new NotFoundException('Пользователь с таким email не зарегистрирован');
    return this.prisma.providerMember.upsert({
      where: { providerId_userId: { providerId, userId: target.id } },
      create: { providerId, userId: target.id, role: dto.role },
      update: { role: dto.role },
    });
  }

  async removeMember(user: AuthUser, providerId: string, userId: string) {
    await this.access.assertMember(user, providerId, [MemberRole.OWNER]);
    if (userId === user.id) throw new BadRequestException('Нельзя удалить самого себя');
    await this.prisma.providerMember.delete({
      where: { providerId_userId: { providerId, userId } },
    });
    return { ok: true };
  }
}
