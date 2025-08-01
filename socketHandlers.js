class SocketHandlers {
    constructor(io, rooms, gameLogic) {
        this.io = io;
        this.rooms = rooms;
        this.gameLogic = gameLogic;
    }

    // Hand and board update utilities
    updateHand(data, player) {
        const room = this.rooms[data.roomId];
        if (player === 'player1') {
            data.hand = this.gameLogic.sortByString(room.player1Hand);
            this.io.to(room.player1).emit('updateHand', data);
            this.io.to(room.player2).emit('updateOpponentHand', data);
        } else {
            data.hand = this.gameLogic.sortByString(room.player2Hand);
            this.io.to(room.player2).emit('updateHand', data);
            this.io.to(room.player1).emit('updateOpponentHand', data);
        }
    }

    updateBoard(data) {
        const room = this.rooms[data.roomId];
        
        // Send board state to player 1
        const player1BoardData = {
            roomId: data.roomId,
            playerMinion: room.player1Minion,
            playerSpell: room.player1Spell,
            opponentMinion: room.player2Minion,
            opponentSpell: room.player2Spell
        };
        this.io.to(room.player1).emit('updateBoard', player1BoardData);
        this.io.to(room.player1).emit('updateOpponentBoard', player1BoardData);
        
        // Send board state to player 2
        const player2BoardData = {
            roomId: data.roomId,
            playerMinion: room.player2Minion,
            playerSpell: room.player2Spell,
            opponentMinion: room.player1Minion,
            opponentSpell: room.player1Spell
        };
        this.io.to(room.player2).emit('updateBoard', player2BoardData);
        this.io.to(room.player2).emit('updateOpponentBoard', player2BoardData);
    }

    sendFullBoardState(roomId) {
        const room = this.rooms[roomId];
        
        // Send complete board state to both players
        const player1BoardData = {
            roomId: roomId,
            playerMinion: room.player1Minion,
            playerSpell: room.player1Spell,
            opponentMinion: room.player2Minion,
            opponentSpell: room.player2Spell
        };
        this.io.to(room.player1).emit('fullBoardUpdate', player1BoardData);
        
        const player2BoardData = {
            roomId: roomId,
            playerMinion: room.player2Minion,
            playerSpell: room.player2Spell,
            opponentMinion: room.player1Minion,
            opponentSpell: room.player1Spell
        };
        this.io.to(room.player2).emit('fullBoardUpdate', player2BoardData);
    }

    sendManaUpdate(room, playerId) {
        const isPlayer1 = playerId === room.player1;
        const playerMana = isPlayer1 ? room.player1Mana : room.player2Mana;
        
        this.io.to(playerId).emit('updateMana', { mana: playerMana });
    }

    sendCardStateUpdate(room, cardInstance, state) {
        // Send updated card state to both players
        const cardUpdate = {
            uuid: cardInstance.uuid,
            // Add other state that might change
        };
        switch (state) {
            case 'tapped':
                cardUpdate.tapped = cardInstance.tapped;
                break;
            case 'untapped':
                cardUpdate.untapped = cardInstance.untapped;
                break;
            // Add more cases as needed
        }

        
        this.io.to(room.player1).emit('updateCardState', cardUpdate);
        this.io.to(room.player2).emit('updateCardState', cardUpdate);
    }

    relayMessage(socket, event, data) {
        const room = this.rooms[data.roomId];
        if (socket.id === room.player1) {
            this.io.to(room.player2).emit(event, data);
        } else {
            this.io.to(room.player1).emit(event, data);
        }
    }
}

module.exports = SocketHandlers;
