import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { PlatformRole } from '@prisma/client';

/** Пользователь из JWT, который кладёт в request стратегия JwtStrategy. */
export interface AuthUser {
  id: string;
  email: string;
  role: PlatformRole;
}

export const IS_PUBLIC_KEY = 'isPublic';
/** Эндпоинт доступен без авторизации. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Ограничение по роли на платформе (USER / ADMIN). */
export const Roles = (...roles: PlatformRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
