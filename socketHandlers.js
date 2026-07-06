// SocketHandlers.js

class SocketHandlers {
    constructor(io, rooms, gameLogic) {
        this.io = io;
        this.rooms = rooms;
        this.gameLogic = gameLogic;
    }

    // Private Helper: Reverses perspective depending on which player is looking at the board
    _getPerspectiveBoardData(room, playerId, roomId) {
        const isPlayer1 = playerId === room.player1;
        return {
            roomId: roomId,
            playerMinion: isPlayer1 ? room.player1Minion : room.player2Minion,
            playerSpell: isPlayer1 ? room.player1Spell : room.player2Spell,
            opponentMinion: isPlayer1 ? room.player2Minion : room.player1Minion,
            opponentSpell: isPlayer1 ? room.player2Spell : room.player1Spell
        };
    }

    updateHand(roomId, playerKey) {
        const room = this.rooms[roomId];
        if (!room) return;

        const isP1 = playerKey === 'player1';
        const activeHand = isP1 ? room.player1Hand : room.player2Hand;
        const activePlayerId = isP1 ? room.player1 : room.player2;
        const opponentPlayerId = isP1 ? room.player2 : room.player1;

        const sortedHand = this.gameLogic.sortByString(activeHand);

        // Emit fresh payloads without mutating shared objects
        this.io.to(activePlayerId).emit('updateHand', { roomId, hand: sortedHand });
        this.io.to(opponentPlayerId).emit('updateOpponentHand', { roomId, hand: sortedHand });
    }

    updateBoard(roomId) {
        const room = this.rooms[roomId];
        if (!room) return;

        // Sync fresh perspectives out to both players respectively
        this.io.to(room.player1).emit('updateBoard', this._getPerspectiveBoardData(room, room.player1, roomId));
        this.io.to(room.player2).emit('updateBoard', this._getPerspectiveBoardData(room, room.player2, roomId));
    }

    sendFullBoardState(roomId) {
        const room = this.rooms[roomId];
        if (!room) return;

        this.io.to(room.player1).emit('fullBoardUpdate', this._getPerspectiveBoardData(room, room.player1, roomId));
        this.io.to(room.player2).emit('fullBoardUpdate', this._getPerspectiveBoardData(room, room.player2, roomId));
    }

    sendManaUpdate(roomId, playerId) {
        const room = this.rooms[roomId];
        if (!room) return;

        const isPlayer1 = playerId === room.player1;
        const playerMana = isPlayer1 ? room.player1Mana : room.player2Mana;
        
        this.io.to(playerId).emit('updateMana', { mana: playerMana });
    }

    sendCardStateUpdate(roomId, cardInstance) {
        const room = this.rooms[roomId];
        if (!room || !cardInstance) return;

        // Provide a standardized payload matching your blueprint's structural format
        const cardUpdate = {
            uuid: cardInstance.uuid,
            isTapped: cardInstance.state?.isTapped ?? false,
            damageTaken: cardInstance.state?.damageTaken ?? 0,
            counters: cardInstance.state?.counters ?? {}
        };

        this.io.to(room.player1).emit('updateCardState', cardUpdate);
        this.io.to(room.player2).emit('updateCardState', cardUpdate);
    }

    relayMessage(socket, event, data) {
        const room = this.rooms[data.roomId];
        if (!room) return;

        const targetSocketId = socket.id === room.player1 ? room.player2 : room.player1;
        this.io.to(targetSocketId).emit(event, data);
    }
}

module.exports = SocketHandlers;