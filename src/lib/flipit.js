export const PLAYER_CAP = 500
export const ROUND_SECONDS = 30
export const ROUND_COUNT = 10

export const SHAPES = [
  { key: 'triangle', symbol: '△', label: 'TRIANGLE', glow: '#f3d17c' },
  { key: 'circle', symbol: '○', label: 'CIRCLE', glow: '#78d8ff' },
  { key: 'square', symbol: '▢', label: 'SQUARE', glow: '#d0b4ff' },
  { key: 'cross', symbol: '✕', label: 'CROSS', glow: '#ff8a98' },
  { key: 'star', symbol: '★', label: 'STAR', glow: '#ffe583' },
]

export const CAT_BACKS = [
  '/mascots/cat-1.png',
  '/mascots/cat-2.png',
  '/mascots/cat-3.png',
  '/mascots/cat-4.png',
  '/mascots/cat-5.png',
]

export const BOT_PROFILES = [
  { id: 'bot-1', name: 'CryptoKat', style: 'calculating' },
  { id: 'bot-2', name: 'NeonRider', style: 'steady' },
  { id: 'bot-3', name: 'ShadowFox', style: 'cheater' },
]

export function shuffle(list) {
  const next = [...list]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }
  return next
}

export function createRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

export function shapeByKey(key) {
  return SHAPES.find((shape) => shape.key === key) ?? SHAPES[0]
}

export function createRoundSequence() {
  const counts = Object.fromEntries(SHAPES.map((shape) => [shape.key, 2]))

  while (true) {
    const sequence = []
    let previous = null

    for (let index = 0; index < ROUND_COUNT; index += 1) {
      const options = SHAPES.filter((shape) => counts[shape.key] > 0 && shape.key !== previous)
      if (options.length === 0) {
        break
      }

      const choice = options[Math.floor(Math.random() * options.length)]
      sequence.push(choice)
      counts[choice.key] -= 1
      previous = choice.key
    }

    if (sequence.length === ROUND_COUNT) {
      return sequence
    }

    for (const shape of SHAPES) {
      counts[shape.key] = 2
    }
  }
}

export function createRoundDeck(targetShapeKey) {
  const targetShape = shapeByKey(targetShapeKey)
  const remainingShapes = shuffle(SHAPES.filter((shape) => shape.key !== targetShapeKey))
  const correctCardIndex = Math.floor(Math.random() * CAT_BACKS.length)
  const deckShapes = [...remainingShapes]
  deckShapes.splice(correctCardIndex, 0, targetShape)
  const mascots = shuffle(CAT_BACKS)

  return deckShapes.map((shape, index) => ({
    id: `card-${index + 1}`,
    mascot: mascots[index],
    shape,
    isCorrect: index === correctCardIndex,
  }))
}

export function createPlayerRoster(username, isHost) {
  const userName = username?.trim() || 'You'
  return [
    {
      id: 'player-user',
      name: userName,
      isBot: false,
      isHost,
      points: 0,
      streak: 0,
      removed: false,
      guess: null,
      guessAt: null,
    },
    ...BOT_PROFILES.map((bot, index) => ({
      id: bot.id,
      name: bot.name,
      isBot: true,
      style: bot.style,
      isHost: !isHost && index === 0,
      points: 0,
      streak: 0,
      removed: false,
      guess: null,
      guessAt: null,
    })),
  ]
}

export function resetRoster(players) {
  return players.map((player) => ({
    ...player,
    points: 0,
    streak: 0,
    removed: false,
    guess: null,
    guessAt: null,
  }))
}

export function chooseBotGuess(player, roundIndex, targetShapeKey) {
  if (!player.isBot || player.removed) {
    return { key: null, delayMs: 0 }
  }

  if (player.style === 'cheater' && roundIndex < 4) {
    return { key: targetShapeKey, delayMs: 2500 }
  }

  const accuracy =
    player.style === 'calculating' ? 0.68 : player.style === 'steady' ? 0.54 : 0.38

  if (Math.random() < accuracy) {
    return {
      key: targetShapeKey,
      delayMs: 2000 + Math.floor(Math.random() * 5500),
    }
  }

  const wrongShapes = SHAPES.filter((shape) => shape.key !== targetShapeKey)
  return {
    key: wrongShapes[Math.floor(Math.random() * wrongShapes.length)].key,
    delayMs: 9000 + Math.floor(Math.random() * 8000),
  }
}

export function rankPlayers(players) {
  return [...players]
    .sort((left, right) => {
      if (left.removed !== right.removed) {
        return left.removed ? 1 : -1
      }
      if (right.points !== left.points) {
        return right.points - left.points
      }
      return right.streak - left.streak
    })
    .map((player, index) => ({
      ...player,
      rank: index + 1,
      status: player.removed ? 'Removed - Possible Cheat' : player.streak >= 3 ? 'Suspicious' : 'Active',
    }))
}
