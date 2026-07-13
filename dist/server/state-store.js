"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryStore = void 0;
class InMemoryStore {
    constructor() {
        this.rooms = new Map();
    }
    getRoom(roomId) {
        return this.rooms.get(roomId);
    }
    saveRoom(room) {
        this.rooms.set(room.roomId, room);
    }
    deleteRoom(roomId) {
        this.rooms.delete(roomId);
    }
    listRooms() {
        return Array.from(this.rooms.keys());
    }
}
exports.InMemoryStore = InMemoryStore;
//# sourceMappingURL=state-store.js.map