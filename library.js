class card {
    constructor(cardId, type, name, cost, text, uuid) {
        this.cardId = cardId;
        this.type = type;
        this.name = name;
        this.cost = cost;
        this.text = text;
        this.uuid = uuid;
        this.isHidden = false; // Default value
    }
}

const cards = {}

cards['rock'] = {
    cardId: 'rock',
    type: 'minion',
    name: '石頭',
    isHidden: true,
    cost: { red: 0 },
    text: 'Rock Paper Scissors card',
    effects: [
        { type: 'clear_hand' }
    ],
    uuid: 'rock'
}

cards['paper'] = {
    cardId: 'paper',
    type: 'minion',
    name: '布',
    isHidden: true,
    cost: { red: 0 },
    text: 'Rock Paper Scissors card',
    effects: [
        { type: 'clear_hand' }
    ],
    uuid: 'paper'
}

cards['scissors'] = {
    cardId: 'scissors',
    type: 'minion',
    name: '剪刀',
    isHidden: true,
    cost: { red: 0 },
    text: 'Rock Paper Scissors card',
    effects: [
        { type: 'clear_hand' }
    ],
    uuid: 'scissors'
}

cards['empire-servant'] = {
    cardId: 'empire-servant',
    name: '帝國奴僕',
    type: 'minion',
    cost: { red: 1 },
    power: 1,
    health: 1,
    text: '① 橫置：生產一點炎屬性能量',
    
    // When played
    effects: [
        { type: 'summon_creature' }
    ],
    
    // Activated abilities
    abilities: [
        {
            name: 'Tap for Red Mana',
            cost: { tap: true },
            effects: [
                { type: 'add_mana', color: 'red', amount: 1 }
            ]
        }
    ]
}

cards['land-red'] = {
    cardId: 'land-red',
    name: '血炎山',
    type: 'land',
    cost: {},
    basic: true,
    text: '此卡不受牌組構築上限限制 ① 橫置：生產一點炎屬性能量',
    
    // When played
    effects: [
        { type: 'play_land' }
    ],
    
    // Activated abilities
    abilities: [
        {
            name: 'Tap for Red Mana',
            cost: { tap: true },
            effects: [
                { type: 'add_mana', color: 'red', amount: 1 }
            ]
        }
    ]
}

cards['lightning-bolt'] = {
    cardId: 'lightning-bolt',
    name: '閃電',
    type: 'spell',
    cost: { red: 1 },
    text: '對任意一個目標造成3點傷害',
    
    effects: [
        { type: 'deal_damage', amount: 3, target: 'chosen_target' }
    ],
    
    needsTarget: true,
    validTargets: ['creature', 'player', 'planeswalker']
}

cards['goblin-warrior'] = {
    cardId: 'goblin-warrior',
    name: '地精戰士',
    type: 'minion',
    cost: { red: 2 },
    power: 2,
    health: 1,
    text: '當地精戰士進入戰場時，造成1點傷害給任意目標',
    
    effects: [
        { type: 'summon_creature' }
    ],
    
    triggers: [
        {
            event: 'enters_battlefield',
            effects: [
                { type: 'deal_damage', amount: 1, target: 'chosen_target' }
            ],
            needsTarget: true,
            validTargets: ['creature', 'player']
        }
    ]
}

cards['counterspell'] = {
    cardId: 'counterspell',
    name: '反制咒語',
    type: 'spell',
    cost: { blue: 2 },
    text: '反制目標咒語',
    
    effects: [
        { type: 'counter_spell', target: 'chosen_target' }
    ],
    
    needsTarget: true,
    validTargets: ['spell_on_stack'],
    canPlayWhen: 'stack_not_empty'
}

module.exports = {
    cards
}