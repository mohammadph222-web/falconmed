export function extractUnits(packageSize) {

if (!packageSize) return 1

let text = packageSize.toLowerCase()

// pattern: 10x3
let match = text.match(/(\d+)\s*x\s*(\d+)/)

if (match) {
return parseInt(match[1]) * parseInt(match[2])
}

// pattern: x 50
match = text.match(/x\s*(\d+)/)

if (match) {
return parseInt(match[1])
}

// pattern: 12's
match = text.match(/(\d+)\s*'?s/)

if (match) {
return parseInt(match[1])
}

// any number
match = text.match(/(\d+)/)

if (match) {
return parseInt(match[1])
}

return 1

}
console.log(extractUnits("10x3 strip"))
console.log(extractUnits("5x4 nebules"))
console.log(extractUnits("12's"))