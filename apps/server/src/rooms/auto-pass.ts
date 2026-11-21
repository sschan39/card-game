import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { PROTOCOL_VERSION, type AutoPassStatus } from '@card-game/protocol';

export interface AutoPassPosition { room: GameRoom; socketId: string }
interface Ports {
  position(roomId: string): AutoPassPosition | undefined;
  eligible(position: AutoPassPosition, passForTurn: boolean): boolean;
  authorize?(socketId: string, roomId: string): boolean | Promise<boolean>;
  pass(socketId: string, roomId: string): void;
  changed(socketId: string, status: AutoPassStatus): void;
}
interface Scheduled { position: AutoPassPosition; passAt: number; timer: ReturnType<typeof setTimeout> }

/** One delayed pass per unchanged room position; timers never own or mutate game state. */
export class AutoPassCoordinator {
  private readonly enabled = new Set<string>();
  private readonly turnPasses = new Map<string, Map<string, number>>();
  private readonly scheduled = new Map<string, Scheduled>();
  constructor(private readonly ports: Ports, private readonly delayMs = 0) {}

  /** Preferences belong to this live socket and are acknowledged only to that player. */
  setEnabled(socketId: string, roomId: string, enabled: boolean, untilTurn?: number): void {
    const changed = this.enabled.has(socketId) !== enabled || this.turnPasses.get(roomId)?.get(socketId) !== untilTurn;
    if (enabled) this.enabled.add(socketId); else this.enabled.delete(socketId);
    if (untilTurn !== undefined) {
      const passes = this.turnPasses.get(roomId) ?? new Map<string, number>();
      passes.set(socketId, untilTurn);
      this.turnPasses.set(roomId, passes);
    } else {
      this.clearTurnPass(roomId, socketId);
    }
    const pending = this.scheduled.get(roomId);
    if (changed && pending?.position.socketId === socketId) this.cancel(roomId);
    const ownPending = this.scheduled.get(roomId);
    this.status(socketId, roomId, ownPending?.position.socketId === socketId ? ownPending.passAt : null);
    this.refresh(roomId);
  }

  /** Re-evaluate after every committed command or connection change. */
  refresh(roomId: string): void {
    const position = this.ports.position(roomId);
    const previous = this.scheduled.get(roomId);
    if (position) {
      for (const [socketId, turn] of this.turnPasses.get(roomId) ?? []) {
        if (turn !== (position.room.turnNumber ?? 0) || position.room.status !== 'playing') {
          this.clearTurnPass(roomId, socketId);
          this.status(socketId, roomId, null);
        }
      }
    }
    if (!position || !this.shouldPass(position)) {
      this.cancel(roomId); return;
    }
    if (previous?.position.room === position.room && previous.position.socketId === position.socketId) return;
    this.cancel(roomId);
    const scheduled: Scheduled = { position, passAt: Date.now() + this.delayMs, timer: setTimeout(() => {
      if (this.scheduled.get(roomId) !== scheduled) return;
      const finish = (allowed: boolean) => {
        if (this.scheduled.get(roomId) !== scheduled) return;
        this.scheduled.delete(roomId);
        this.status(position.socketId, roomId, null);
        if (!allowed) return;
        const current = this.ports.position(roomId);
        if (current?.socketId === position.socketId && current.room === position.room && this.shouldPass(current)) {
          this.ports.pass(position.socketId, roomId);
        }
        this.refresh(roomId);
      };
      try {
        const allowed = this.ports.authorize?.(position.socketId, roomId) ?? true;
        if (typeof allowed === 'boolean') finish(allowed);
        else void allowed.then(finish, () => finish(false));
      } catch { finish(false); }
    }, this.delayMs) };
    scheduled.timer.unref?.();
    this.scheduled.set(roomId, scheduled);
    this.status(position.socketId, roomId, scheduled.passAt);
  }

  /** Reconnection starts with auto-pass off; no preference follows a stale socket or a room exit. */
  forgetSocket(socketId: string): void {
    this.enabled.delete(socketId);
    for (const roomId of this.turnPasses.keys()) this.clearTurnPass(roomId, socketId);
    for (const [roomId, pending] of this.scheduled) if (pending.position.socketId === socketId) this.cancel(roomId);
  }

  /** Cancel room work without retaining old room objects in timer closures. */
  cancel(roomId: string): void {
    const pending = this.scheduled.get(roomId);
    if (!pending) return;
    clearTimeout(pending.timer); this.scheduled.delete(roomId);
    this.status(pending.position.socketId, roomId, null);
  }

  private status(socketId: string, roomId: string, passAt: number | null): void {
    const untilTurn = this.turnPasses.get(roomId)?.get(socketId);
    this.ports.changed(socketId, { protocolVersion: PROTOCOL_VERSION, roomId,
      enabled: this.enabled.has(socketId), passAt, serverTime: Date.now(),
      ...(untilTurn === undefined ? {} : { untilTurn }) });
  }

  private shouldPass(position: AutoPassPosition): boolean {
    const { room, socketId } = position;
    const untilTurn = this.turnPasses.get(room.roomId)?.get(socketId);
    const passForTurn = untilTurn === (room.turnNumber ?? 0);
    return (passForTurn || this.enabled.has(socketId)) && this.ports.eligible(position, passForTurn);
  }

  private clearTurnPass(roomId: string, socketId: string): void {
    const passes = this.turnPasses.get(roomId);
    passes?.delete(socketId);
    if (passes?.size === 0) this.turnPasses.delete(roomId);
  }

  /** Dispose all timers when the server runtime is shut down. */
  dispose(): void {
    for (const roomId of this.scheduled.keys()) this.cancel(roomId);
    this.enabled.clear();
    this.turnPasses.clear();
  }
}
