const { cards } = require('./library');

const decks = {}

decks['pre'] = [
    cards['rock'],
    cards['paper'],
    cards['scissors'],
]

decks['redDeck'] =  [
    cards['empire-servant'],
    cards['empire-servant'],
    cards['empire-servant'],
    cards['empire-servant'],
    cards['empire-servant'],
    cards['land-red'],
    cards['land-red'],
    cards['land-red'],
    cards['land-red'],
];

module.exports = {
    decks
}

