import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import { MemberRole, Prisma, ProviderType, RentalProvider } from '@prisma/client';
import { CreateProviderDto } from '../dto';

/**
 * Паттерн «Стратегия»: у каждого типа арендодателя своя логика регистрации.
 * Новый тип (например, физлицо) подключается новой стратегией без изменения остального кода.
 */
export interface ProviderRegistrationStrategy {
  readonly type: ProviderType;
  register(
    tx: Prisma.TransactionClient,
    ownerId: string,
    dto: CreateProviderDto,
  ): Promise<RentalProvider>;
}

export const REGISTRATION_STRATEGIES = Symbol('REGISTRATION_STRATEGIES');

@Injectable()
export class BusinessRegistrationStrategy implements ProviderRegistrationStrategy {
  readonly type = ProviderType.BUSINESS;

  async register(tx: Prisma.TransactionClient, ownerId: string, dto: CreateProviderDto) {
    if (!dto.business) {
      throw new BadRequestException('Для бизнеса нужны реквизиты компании (поле business)');
    }
    const taken = await tx.businessProfile.findUnique({ where: { taxId: dto.business.taxId } });
    if (taken) throw new ConflictException('Компания с таким ИНН/БИН уже зарегистрирована');

    return tx.rentalProvider.create({
      data: {
        type: ProviderType.BUSINESS,
        displayName: dto.displayName,
        // статус PENDING: компания ждёт проверки администратором
        business: { create: dto.business },
        members: { create: { userId: ownerId, role: MemberRole.OWNER } },
      },
    });
  }
}

@Injectable()
export class IndividualRegistrationStrategy implements ProviderRegistrationStrategy {
  readonly type = ProviderType.INDIVIDUAL;

  register(): Promise<RentalProvider> {
    throw new NotImplementedException(
      'Регистрация арендодателей-физлиц пока не поддерживается. Тип заложен в модели данных.',
    );
  }
}
