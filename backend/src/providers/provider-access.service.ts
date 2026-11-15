import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MemberRole, PlatformRole, ProviderStatus } from '@prisma/client';
import { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

/** Проверки доступа сотрудников арендодателя. Используется модулями автопарка, броней и аренд. */
@Injectable()
export class ProviderAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Пользователь — сотрудник арендодателя (с нужной ролью). Администратор платформы проходит всегда. */
  async assertMember(user: AuthUser, providerId: string, roles?: MemberRole[]) {
    const provider = await this.prisma.rentalProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundException('Арендодатель не найден');
    if (user.role === PlatformRole.ADMIN) return provider;

    const member = await this.prisma.providerMember.findUnique({
      where: { providerId_userId: { providerId, userId: user.id } },
    });
    if (!member || (roles && !roles.includes(member.role))) {
      throw new ForbiddenException('Нет доступа к этому арендодателю');
    }
    return provider;
  }

  /** Сотрудник + арендодатель прошёл проверку (ACTIVE). */
  async assertActiveMember(user: AuthUser, providerId: string, roles?: MemberRole[]) {
    const provider = await this.assertMember(user, providerId, roles);
    if (provider.status !== ProviderStatus.ACTIVE) {
      throw new ForbiddenException('Арендодатель ещё не прошёл проверку или заблокирован');
    }
    return provider;
  }

  async isMember(userId: string, providerId: string) {
    const m = await this.prisma.providerMember.findUnique({
      where: { providerId_userId: { providerId, userId } },
    });
    return !!m;
  }
}
