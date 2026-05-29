import { createRoundSequence, SHAPES, shuffle } from './flipit'
import {
  advanceRoundOnChain,
  createRoomOnChain,
  endGameOnChain,
  getLeaderboardOnChain,
  getRoomStateOnChain,
  getRoundInfoOnChain,
  joinRoomOnChain,
  playAgainOnChain,
  revealRoundOnChain,
  startGameOnChain,
  submitGuessOnChain,
} from './genlayer'
import { ensureWalletConnected, getConnectedWalletAddress, isWalletConnected } from './wallet'

const LOBBY_POLL_MS = 3000
const ACTIVE_ROUND_POLL_MS = 2000
const REVEAL_POLL_MS = 1000
const CARD_IDS = Array.from({ length: 5 }, (_, index) => `card-${index + 1}`)

function normalizeRoomCode(value) {
  return String(value ?? '').trim().toUpperCase()
}

function normalizeUsername(value) {
  return String(value ?? '').trim()
}

function normalizeAddress(value) {
  return String(value ?? '').trim().toLowerCase()
}

function createInitialMapping() {
  const shapeKeys = shuffle(SHAPES.map((shape) => shape.key))
  return Object.fromEntries(CARD_IDS.map((cardId, index) => [cardId, shapeKeys[index]]))
}

async function getSnapshotInternal(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode)
  const [roomState, roundInfo, leaderboard] = await Promise.all([
    getRoomStateOnChain(normalizedRoomCode),
    getRoundInfoOnChain(normalizedRoomCode),
    getLeaderboardOnChain(normalizedRoomCode),
  ])

  return {
    roomState,
    roundInfo,
    leaderboard,
  }
}

function pollingIntervalForSnapshot(snapshot) {
  const status = String(snapshot?.roomState?.status ?? '').toLowerCase()
  const phase = String(snapshot?.roundInfo?.phase ?? '').toLowerCase()

  if (status === 'waiting') return LOBBY_POLL_MS
  if (phase === 'leaderboard' || phase === 'finished') return REVEAL_POLL_MS
  return ACTIVE_ROUND_POLL_MS
}

async function subscribeToRoom(roomCode, onSnapshot) {
  const normalizedRoomCode = normalizeRoomCode(roomCode)
  let cancelled = false
  let timerId = null

  const tick = async () => {
    if (cancelled) return

    try {
      const snapshot = await getSnapshotInternal(normalizedRoomCode)
      if (cancelled) return
      onSnapshot(snapshot)
      timerId = window.setTimeout(tick, pollingIntervalForSnapshot(snapshot))
    } catch (error) {
      if (cancelled) return
      console.error('[flipit] polling failed', error)
      timerId = window.setTimeout(tick, ACTIVE_ROUND_POLL_MS)
    }
  }

  await tick()

  return async () => {
    cancelled = true
    if (timerId) {
      window.clearTimeout(timerId)
    }
  }
}

async function requireWallet() {
  const address = isWalletConnected() ? getConnectedWalletAddress() : await ensureWalletConnected()
  if (!address) {
    throw new Error('Connect your wallet before continuing.')
  }
  return normalizeAddress(address)
}

async function createRoom({ roomCode, hostUsername }) {
  const normalizedRoomCode = normalizeRoomCode(roomCode)
  const normalizedUsername = normalizeUsername(hostUsername)

  if (!normalizedUsername) {
    throw new Error('Username is required.')
  }

  const walletAddress = await requireWallet()
  const roundSequence = createRoundSequence().map((shape) => shape.key)
  const initialMapping = createInitialMapping()

  await createRoomOnChain({
    roomCode: normalizedRoomCode,
    hostAddress: walletAddress,
    hostUsername: normalizedUsername,
    roundSequence,
    initialMapping,
  })

  return getSnapshotInternal(normalizedRoomCode)
}

async function joinRoom({ roomCode, username }) {
  const normalizedRoomCode = normalizeRoomCode(roomCode)
  const normalizedUsername = normalizeUsername(username)

  if (!normalizedUsername) {
    throw new Error('Username is required.')
  }

  const walletAddress = await requireWallet()
  await joinRoomOnChain({
    roomCode: normalizedRoomCode,
    username: normalizedUsername,
    walletAddress,
  })

  return getSnapshotInternal(normalizedRoomCode)
}

async function startGame({ roomCode }) {
  const normalizedRoomCode = normalizeRoomCode(roomCode)
  await requireWallet()
  await startGameOnChain({
    roomCode: normalizedRoomCode,
    startedAt: Date.now(),
  })
  return getSnapshotInternal(normalizedRoomCode)
}

async function submitGuess({ roomCode, username, selectedCardId, guessedShape, guessTimestamp }) {
  const normalizedRoomCode = normalizeRoomCode(roomCode)
  const normalizedUsername = normalizeUsername(username)

  await requireWallet()
  await submitGuessOnChain({
    roomCode: normalizedRoomCode,
    username: normalizedUsername,
    guessedShape: selectedCardId || guessedShape,
    timestamp: Number(guessTimestamp),
  })

  return { ok: true }
}

async function revealRound({ roomCode }) {
  const normalizedRoomCode = normalizeRoomCode(roomCode)
  await requireWallet()
  await revealRoundOnChain({ roomCode: normalizedRoomCode })
  return getSnapshotInternal(normalizedRoomCode)
}

async function advanceRound({ roomCode }) {
  const normalizedRoomCode = normalizeRoomCode(roomCode)
  await requireWallet()
  await advanceRoundOnChain({
    roomCode: normalizedRoomCode,
    initialMapping: createInitialMapping(),
    startedAt: Date.now(),
  })
  return getSnapshotInternal(normalizedRoomCode)
}

async function endGame({ roomCode }) {
  const normalizedRoomCode = normalizeRoomCode(roomCode)
  await requireWallet()
  await endGameOnChain({ roomCode: normalizedRoomCode })
  return getSnapshotInternal(normalizedRoomCode)
}

async function playAgain({ roomCode }) {
  const normalizedRoomCode = normalizeRoomCode(roomCode)
  await requireWallet()
  await playAgainOnChain({
    roomCode: normalizedRoomCode,
    roundSequence: createRoundSequence().map((shape) => shape.key),
    initialMapping: createInitialMapping(),
  })
  return getSnapshotInternal(normalizedRoomCode)
}

async function leaveRoom() {
  return { ok: true }
}

export const api = {
  ensureWalletConnected,
  getConnectedWalletAddress,
  subscribeToRoom,
  getSnapshot: getSnapshotInternal,
  getRoomState: getRoomStateOnChain,
  getLeaderboard: getLeaderboardOnChain,
  getRoundInfo: getRoundInfoOnChain,
  createRoom,
  joinRoom,
  startGame,
  submitGuess,
  revealRound,
  advanceRound,
  endGame,
  playAgain,
  leaveRoom,
}
