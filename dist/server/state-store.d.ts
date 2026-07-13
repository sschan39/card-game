import type { GameRoom } from '../types/game.room.types';
export interface StateStore {
    getRoom(roomId: string): GameRoom | undefined;
    saveRoom(room: GameRoom): void;
    deleteRoom(roomId: string): void;
    listRooms(): string[];
}
export declare class InMemoryStore implements StateStore {
    private rooms;
    getRoom(roomId: string): GameRoom | undefined;
    saveRoom(room: GameRoom): void;
    deleteRoom(roomId: string): void;
    listRooms(): string[];
}
//# sourceMappingURL=state-store.d.ts.map