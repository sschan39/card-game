const cards = {}

cards['rock'] = {
    name: '石頭',
    isHidden: true,
}
cards['paper'] = {
    name: '布',
    isHidden: true,
}
cards['scissors'] = {
    name: '剪刀',
    isHidden: true,
}

cards['empire-servant'] = {
    cardId: 'empire-servant',
    name: '帝國奴僕',
    type: 'minion',
    cost: {red: 1},
    power: 1,
    health: 1,
    text: '① 橫置：生產一點炎屬性能量'
}

cards['land-red'] = {
    cardId: 'land-red',
    name: '血炎山',
    type: 'land',
    cost: null,
    text: '此卡不受牌組構築上限限制 ① 橫置：生產一點炎屬性能量'
}

module.exports = {
    cards
}