import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { PlatformRole } from '@prisma/client';
import { Namespace, Socket } from 'socket.io';
import { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

/**
 * WebSocket (Socket.IO, namespace /live) для данных в реальном времени.
 * Клиент подключается с JWT: io('/live', { auth: { token } }).
 * Комнаты: user:{id}, provider:{id}, admin.
 * События: telemetry, vehicle-event, alert, device-status.
 */
@WebSocketGateway({ namespace: '/live', cors: { origin: true, credentials: true } })
export class LiveGateway implements OnGatewayConnection {
  private readonly logger = new Logger(LiveGateway.name);

  @WebSocketServer()
  server: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.query?.token as string | undefined);
      if (!token) throw new Error('no token');
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      client.data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);
      if (payload.role === PlatformRole.ADMIN) await client.join('admin');
      const memberships = await this.prisma.providerMember.findMany({
        where: { userId: payload.sub },
        select: { providerId: true },
      });
      for (const m of memberships) await client.join(`provider:${m.providerId}`);
    } catch {
      client.emit('error', 'unauthorized');
      client.disconnect(true);
    }
  }

  toProvider(providerId: string, event: string, data: unknown) {
    this.server?.to(`provider:${providerId}`).to('admin').emit(event, data);
  }

  toUser(userId: string, event: string, data: unknown) {
    this.server?.to(`user:${userId}`).emit(event, data);
  }
}
