card['1'] = {
    name: '1',
}

// Create new objects for each element in the array
li = [ {...card['1']}, {...card['1']} ]

console.log(li[1].name) // 1
li[1].name = '2'
console.log(li[1].name) // 2
console.log(card['1'].name) // 1

// Changing the first item in li
li[0].name = '3'
console.log(li[0].name) // 3
console.log(li[1].name) // 2
console.log(card['1'].name) // 1

{...card['1']}.data = 'data'
li.push({...card['1']})
console.log(li[2].data)

