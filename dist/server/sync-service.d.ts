import type { Server } from 'socket.io';
import type { GameRoom, PlayerId } from '../types/game.room.types';
export interface DeltaChange {
    path: string;
    op: 'add' | 'remove' | 'replace' | 'update';
    value?: unknown;
    oldValue?: unknown;
}
export interface StateDelta {
    roomId: string;
    seq: number;
    timestamp: number;
    action?: string;
    playerId?: PlayerId;
    changes: DeltaChange[];
}
export declare class SyncService {
    private io;
    private deltaLogPath;
    private sequences;
    constructor(io: Server, deltaLogPath?: string);
    sync(oldState: GameRoom, newState: GameRoom, context: {
        action: string;
        playerId: PlayerId;
    }): void;
    replay(roomId: string, fromSeq?: number): StateDelta[];
    private nextSeq;
    private computeDiff;
    private appendToLog;
}
//# sourceMappingURL=sync-service.d.ts.map