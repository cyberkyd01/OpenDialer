import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { Server, type Socket } from 'socket.io';
import { RT_NAMESPACE, type Ack, type ClientToServerEvents, type ServerToClientEvents } from '@opendialer/shared';
import type { AuthUser } from './auth.js';
import { userFromToken } from './auth.js';
import type { Ctx } from './context.js';
import type { Engine } from './engine.js';
import { HttpError } from './errors.js';

type RtSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>;

export function createRealtime(ctx: Ctx, engine: Engine, servers: (HttpServer | HttpsServer)[]) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>({
    cors: { origin: ctx.config.corsOrigins.length ? ctx.config.corsOrigins : true, credentials: true },
    pingInterval: 10000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6,
  });
  for (const s of servers) io.attach(s);
  const nsp = io.of(RT_NAMESPACE);
  const sockets = new Map<number, RtSocket>();

  nsp.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string })?.token;
    const user = userFromToken(ctx, token);
    if (!user) return next(new Error('unauthorized'));
    (socket as RtSocket).data.user = user;
    next();
  });

  engine.setTransport({
    toUser: (userId, event, ...args) => {
      const s = sockets.get(userId);
      if (s) (s.emit as (...a: unknown[]) => void)(event, ...args);
    },
    toSupervisors: (event, ...args) => {
      (nsp.to('wallboard').emit as (...a: unknown[]) => void)(event, ...args);
    },
    supervisorCount: () => nsp.adapter.rooms.get('wallboard')?.size ?? 0,
  });

  const handle =
    <P, R>(socket: RtSocket, fn: (p: P) => R) =>
    (p: P, ack?: (r: Ack<R>) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply({ ok: true, data: fn(p ?? ({} as P)) });
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : (err as Error)?.message ?? 'error';
        if (!(err instanceof HttpError)) ctx.log.error({ err, user: socket.data.user.username }, 'socket handler failed');
        reply({ ok: false, error: msg });
      }
    };

  nsp.on('connection', (raw) => {
    const socket = raw as RtSocket;
    const user = socket.data.user;
    const previous = sockets.get(user.id);
    if (previous && previous.id !== socket.id) {
      previous.emit('session:replaced');
      previous.data.user = { ...previous.data.user, id: -1 }; // mark so its disconnect handler is a no-op
      previous.disconnect(true);
    }
    sockets.set(user.id, socket);
    ctx.log.info({ user: user.username, socket: socket.id }, 'agent connected');
    engine.reconnected(user.id);

    socket.on('agent:join', handle(socket, (p: { campaignId: number | null }) => engine.join(user, p.campaignId ?? null)));
    socket.on('agent:ready', handle(socket, () => engine.ready(user.id)));
    socket.on('agent:pause', handle(socket, (p: { code: string }) => engine.pause(user.id, String(p.code ?? 'Pause').slice(0, 40))));
    socket.on('agent:leave', handle(socket, () => engine.leave(user.id)));
    socket.on('lead:skip', handle(socket, (p: { leadId: number; requeue: boolean }) => engine.skip(user.id, Number(p.leadId), p.requeue !== false)));
    socket.on('lead:dial', handle(socket, (p: { leadId: number }) => engine.dial(user.id, Number(p.leadId))));
    socket.on(
      'manual:dial',
      handle(socket, (p: { phone: string; campaignId?: number | null; leadId?: number | null }) =>
        engine.manualDial(user.id, String(p.phone ?? ''), p.campaignId ?? null, p.leadId ?? null),
      ),
    );
    socket.on('call:update', handle(socket, (p: Parameters<ClientToServerEvents['call:update']>[0]) => engine.callUpdate(user.id, p)));
    socket.on('call:dispose', handle(socket, (p: Parameters<ClientToServerEvents['call:dispose']>[0]) => engine.dispose(user.id, p)));
    socket.on(
      'wallboard:subscribe',
      handle(socket, () => {
        if (user.role === 'agent') throw new HttpError(403, 'Supervisors only');
        socket.join('wallboard');
        return engine.snapshot();
      }),
    );
    socket.on(
      'wallboard:unsubscribe',
      handle(socket, () => {
        socket.leave('wallboard');
        return undefined;
      }),
    );

    socket.on('disconnect', (reason) => {
      if (socket.data.user.id === -1) return; // replaced by a newer connection
      if (sockets.get(user.id)?.id === socket.id) sockets.delete(user.id);
      ctx.log.info({ user: user.username, reason }, 'agent disconnected');
      engine.disconnected(user.id);
    });
  });

  return { io, nsp, sockets };
}
