var card = {}
card['1'] = {
    name: '12',
}
card['2'] = {
    name: '3',
}
card['3'] = {
    name: '5',
}
card['4'] = {
    name: '12',
}

hand = [card['1'], card['2'], card['3'], card['4']]
console.log(hand)
hand.sort((a, b) => a.name.localeCompare(b.name));
console.log(hand)


// Create new objects for each element in the array
//li = [ {...card['1']}, {...card['1']} ]

//console.log(li[1].name) // 1
//li[1].name = '2'
//console.log(li[1].name) // 2
//console.log(card['1'].name) // 1

// Changing the first item in li
//li[0].name = '3'
//console.log(li[0].name) // 3
//console.log(li[1].name) // 2
//console.log(card['1'].name) // 1

//let newCard = {...card['1']};
//newCard.data = 'data';
//li.push({...card['1']})
//console.log(li[2].data)

