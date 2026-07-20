"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRoom = createRoom;
exports.joinRoom = joinRoom;
exports.setupRPS = setupRPS;
exports.dealStartingHands = dealStartingHands;
const card_factory_1 = require("../library/card-factory");
function createDefaultPlayer(id) {
    return {
        id,
        life: 20,
        mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 },
        deck: [],
        hand: [],
        graveyard: []
    };
}
function createRoom(roomId, player1Id) {
    return {
        roomId,
        player1Id: player1Id,
        player2Id: null,
        players: {
            [player1Id]: createDefaultPlayer(player1Id)
        },
        currentPhase: 'waiting',
        activeTurnPlayerId: player1Id,
        priorityPlayerId: null,
        lastPassedPlayerId: null,
        battlefield: [],
        stack: [],
        rpsState: {
            status: 'pending',
            playedCards: {}
        }
    };
}
function joinRoom(room, player2Id) {
    room.player2Id = player2Id;
    room.players[player2Id] = createDefaultPlayer(player2Id);
}
function setupRPS(room) {
    room.currentPhase = 'RPS';
    if (!room.player2Id)
        return;
    const p1 = room.players[room.player1Id];
    const p2 = room.players[room.player2Id];
    room.battlefield = [];
    p1.hand = [];
    p2.hand = [];
    p1.hand.push((0, card_factory_1.instantiateCard)('rock'), (0, card_factory_1.instantiateCard)('paper'), (0, card_factory_1.instantiateCard)('scissors'));
    p2.hand.push((0, card_factory_1.instantiateCard)('rock'), (0, card_factory_1.instantiateCard)('paper'), (0, card_factory_1.instantiateCard)('scissors'));
}
function dealStartingHands(room) {
    if (!room.player2Id)
        return;
    const p1 = room.players[room.player1Id];
    const p2 = room.players[room.player2Id];
    p1.hand = [];
    p2.hand = [];
    for (let i = 0; i < 4; i++) {
        const p1Card = p1.deck.pop();
        if (p1Card)
            p1.hand.push(p1Card);
        const p2Card = p2.deck.pop();
        if (p2Card)
            p2.hand.push(p2Card);
    }
}
