import { CAT_BACKS, ROUND_COUNT, ROUND_SECONDS, SHAPES } from './flipit'

const SHAPE_MAP = Object.fromEntries(SHAPES.map((shape) => [shape.key, shape]))
const PLAYER_ID_PREFIX = 'player-'

function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function playerId(username) {
  const slug = slugify(username)
  return `${PLAYER_ID_PREFIX}${slug || 'guest'}`
}

function statusToFlags(status) {
  const normalized = String(status ?? 'active').toLowerCase()
  return {
    removed: normalized === 'removed',
    suspicious: normalized === 'suspicious',
  }
}

export function emptyGameState() {
  return {
    sequence: Array.from({ length: ROUND_COUNT }, () => SHAPES[0]),
    roundIndex: 0,
    targetShape: SHAPES[0],
    deck: Array.from({ length: 5 }, (_, index) => ({
      id: `card-${index + 1}`,
      mascot: CAT_BACKS[index % CAT_BACKS.length],
      shape: SHAPES[index % SHAPES.length],
      isCorrect: false,
    })),
    timeLeft: ROUND_SECONDS,
    phase: 'idle',
    revealed: false,
    selectedCardId: null,
    startedAt: 0,
  }
}

export function normalizePlayersForUi(roomState, leaderboardPayload, currentUsername) {
  const leaderboardEntries = leaderboardPayload?.entries ?? []
  const leaderboardByName = new Map(leaderboardEntries.map((entry) => [entry.username.toLowerCase(), entry]))

  return (roomState?.players ?? []).map((player) => {
    const ranked = leaderboardByName.get(player.username.toLowerCase())
    const status = ranked?.status ?? player.status ?? 'active'
    const flags = statusToFlags(status)

    return {
      id: playerId(player.username),
      name: player.username,
      isBot: false,
      isHost: Boolean(player.isHost),
      points: Number(ranked?.points ?? player.points ?? 0),
      streak: Number(player.streak ?? 0),
      removed: flags.removed,
      guess: null,
      guessAt: null,
      status,
      isCurrentUser: player.username.trim().toLowerCase() === currentUsername.trim().toLowerCase(),
    }
  })
}

function cardShape(card, index) {
  const shapeKey = card?.revealedShapeKey || card?.shapeKey
  return SHAPE_MAP[shapeKey] ?? SHAPES[index % SHAPES.length]
}

export function normalizeGameStateForUi(roundInfo, selectedCardId) {
  const roundStartedAt = Number(roundInfo?.startedAt ?? 0)
  const endsAt = Number(roundInfo?.endsAt ?? 0)
  const rawSeconds = endsAt > 0 ? Math.ceil((endsAt - Date.now()) / 1000) : ROUND_SECONDS
  const timeLeft = roundInfo?.phase === 'playing' ? Math.max(0, Math.min(ROUND_SECONDS, rawSeconds)) : 0
  const deck = (roundInfo?.cards ?? []).map((card, index) => ({
    id: card.id || `card-${index + 1}`,
    mascot: CAT_BACKS[index % CAT_BACKS.length],
    shape: cardShape(card, index),
    isCorrect: Boolean(card.isCorrect),
  }))

  return {
    sequence: Array.from({ length: ROUND_COUNT }, () => SHAPES[0]),
    roundIndex: Math.max(Number(roundInfo?.roundIndex ?? 0), 0),
    targetShape: SHAPE_MAP[roundInfo?.targetShapeKey] ?? SHAPES[0],
    deck: deck.length > 0 ? deck : emptyGameState().deck,
    timeLeft,
    phase: roundInfo?.phase ?? 'idle',
    revealed: Boolean(roundInfo?.revealed),
    selectedCardId: selectedCardId ?? null,
    startedAt: roundStartedAt,
  }
}

export function normalizeLeaderboardForUi(leaderboardPayload) {
  return (leaderboardPayload?.entries ?? []).map((entry, index) => {
    const status = String(entry.status ?? 'active').toLowerCase()
    return {
      id: playerId(entry.username),
      name: entry.username,
      points: Number(entry.points ?? 0),
      rank: Number(entry.rank ?? index + 1),
      removed: status === 'removed',
      status: status === 'removed' ? 'Removed - Possible Cheat' : status === 'suspicious' ? 'Suspicious' : 'Active',
    }
  })
}

export function buildFlashState(snapshot) {
  const result = snapshot?.roundInfo?.resultSummary
  if (!result) {
    return { correct: [], wrong: [], removed: [] }
  }

  return {
    correct: (result.correctUsernames ?? []).map(playerId),
    wrong: (result.wrongUsernames ?? []).map(playerId),
    removed: (result.removedUsernames ?? []).map(playerId),
  }
}

export function getActiveCount(players) {
  return players.filter((player) => !player.removed).length
}
