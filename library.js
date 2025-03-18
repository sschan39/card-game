const cards = {}

cards['rock'] = {
    cardId: 'rock',
    type: 'minion',
    name: '石頭',
    isHidden: true,
    cost: {red: 0},
    onPlay(io, socket, room) {
        io.to(socket.id).emit('removeHand');
        if (socket.id === room.player1) {
            room.player1Hand = [];
        } else if (socket.id === room.player2) {
            room.player2Hand = [];
        } else {
            console.log("playerId unmatch");
            return;
        }
    },
    uuid: 'rock'
}
cards['paper'] = {
    cardId: 'paper',
    type: 'minion',
    name: '布',
    isHidden: true,
    cost: {red: 0},
    onPlay(io, socket, room) {
        io.to(socket.id).emit('removeHand');
        if (socket.id === room.player1) {
            room.player1Hand = [];
        } else if (socket.id === room.player2) {
            room.player2Hand = [];
        } else {
            console.log("playerId unmatch");
            return;
        }
    },
    uuid: 'paper'
}
cards['scissors'] = {
    cardId: 'scissors',
    type: 'minion',
    name: '剪刀',
    isHidden: true,
    cost: {red: 0},
    onPlay(io, socket, room) {
        io.to(socket.id).emit('removeHand');
        if (socket.id === room.player1) {
            room.player1Hand = [];
        } else if (socket.id === room.player2) {
            room.player2Hand = [];
        } else {
            console.log("playerId unmatch");
            return;
        }
    },
    uuid: 'scissors'
}

cards['empire-servant'] = {
    cardId: 'empire-servant',
    name: '帝國奴僕',
    type: 'minion',
    cost: {red: 1},
    power: 1,
    health: 1,
    text: '① 橫置：生產一點炎屬性能量',
    onboardOne(io, socket) {
        this.tapped = true;
        if (socket.id === rooms[socket.roomId].player1) {
            rooms[socket.roomId].player1Mana.red++;
        } else {
            rooms[socket.roomId].player2Mana.red++;
        }
    },
}

cards['land-red'] = {
    cardId: 'land-red',
    name: '血炎山',
    type: 'land',
    cost: null,
    text: '此卡不受牌組構築上限限制 ① 橫置：生產一點炎屬性能量',
    onboardOne(io, socket) {
        this.tapped = true;
        if (socket.id === rooms[socket.roomId].player1) {
            rooms[socket.roomId].player1Mana.red++;
        } else {
            rooms[socket.roomId].player2Mana.red++;
        }
    },
}

module.exports = {
    cards
}