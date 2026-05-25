import { createAccount, createClient } from 'genlayer-js'
import { ExecutionResult, TransactionStatus } from 'genlayer-js/types'

const SHAPE_KEYS = ['triangle', 'circle', 'square', 'cross', 'star']
const DEFAULT_CARD_IDS = Array.from({ length: 5 }, (_, index) => `card-${index + 1}`)

function toPlainJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_, nestedValue) => (typeof nestedValue === 'bigint' ? Number(nestedValue) : nestedValue)),
  )
}

function sanitizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null)
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase())
  return false
}

function normalizeShapeKey(value) {
  const key = String(value ?? '').trim().toLowerCase()
  return SHAPE_KEYS.includes(key) ? key : null
}

function statusFromPlayer(player) {
  const explicit = String(firstDefined(player.status, player.player_status, '')).trim().toLowerCase()
  if (explicit === 'removed' || explicit.includes('cheat')) return 'removed'
  if (explicit === 'suspicious') return 'suspicious'
  if (toBoolean(firstDefined(player.removed, player.is_removed))) return 'removed'
  if (toBoolean(firstDefined(player.suspicious, player.is_suspicious))) return 'suspicious'
  return 'active'
}

function normalizePlayers(rawPlayers = [], hostUsername = '') {
  return asArray(rawPlayers).map((player, index) => {
    const username = String(firstDefined(player.username, player.name, player.display_name, `Player ${index + 1}`))
    const status = statusFromPlayer(player)
    return {
      username,
      points: Number(firstDefined(player.points, player.score, 0)),
      streak: Number(firstDefined(player.streak, player.correct_streak, 0)),
      status,
      removed: status === 'removed',
      isHost:
        toBoolean(firstDefined(player.is_host, player.host, player.isHost)) || sanitizeName(username) === sanitizeName(hostUsername),
    }
  })
}

function normalizeRoomState(rawRoomState) {
  const roomState = toPlainJson(rawRoomState ?? {})
  const hostUsername = String(firstDefined(roomState.host_username, roomState.hostUsername, roomState.host, ''))
  const players = normalizePlayers(firstDefined(roomState.players, roomState.player_list, roomState.roster, []), hostUsername)
  const status = String(firstDefined(roomState.status, roomState.game_status, roomState.room_status, 'waiting')).toLowerCase()

  return {
    roomCode: String(firstDefined(roomState.room_code, roomState.roomCode, roomState.code, '')),
    status: status === 'finished' ? 'finished' : status === 'active' ? 'active' : 'waiting',
    roundNumber: Number(firstDefined(roomState.round_number, roomState.current_round, roomState.round, 0)),
    hostUsername,
    players,
  }
}

function normalizeLeaderboard(rawLeaderboard) {
  const payload = toPlainJson(rawLeaderboard ?? {})
  const list = asArray(firstDefined(payload.entries, payload.leaderboard, payload.players, payload))

  const entries = list.map((entry, index) => {
    const username = String(firstDefined(entry.username, entry.name, entry.display_name, `Player ${index + 1}`))
    const status = statusFromPlayer(entry)
    return {
      rank: Number(firstDefined(entry.rank, index + 1)),
      username,
      points: Number(firstDefined(entry.points, entry.score, 0)),
      status,
      removed: status === 'removed',
    }
  })

  entries.sort((left, right) => {
    if (left.removed !== right.removed) {
      return left.removed ? 1 : -1
    }
    if (right.points !== left.points) {
      return right.points - left.points
    }
    return left.rank - right.rank
  })

  return {
    roomCode: String(firstDefined(payload.room_code, payload.roomCode, payload.code, '')),
    entries: entries.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    })),
  }
}

function normalizeCardId(value, fallbackIndex) {
  if (value) return String(value)
  return DEFAULT_CARD_IDS[fallbackIndex] ?? `card-${fallbackIndex + 1}`
}

function shapeFromCardObject(card) {
  return normalizeShapeKey(firstDefined(card.shape, card.shape_key, card.shapeKey, card.revealed_shape, card.revealedShapeKey))
}

function normalizeCardsFromList(cards = []) {
  return asArray(cards).map((card, index) => ({
    id: normalizeCardId(firstDefined(card.card_id, card.cardId, card.id), index),
    shapeKey: shapeFromCardObject(card),
    isCorrect: toBoolean(firstDefined(card.is_correct, card.correct, card.isCorrect)),
  }))
}

function normalizeCardsFromMapping(mapping) {
  const objectValue = asObject(mapping)
  if (!objectValue) return []

  const cards = []
  const entries = Object.entries(objectValue)

  for (const [left, right] of entries) {
    const leftShape = normalizeShapeKey(left)
    const rightShape = normalizeShapeKey(right)

    if (leftShape && !rightShape) {
      const cardIndex = Number(String(right).replace(/\D/g, '')) - 1
      cards.push({
        id: normalizeCardId(`card-${cardIndex + 1}`, cardIndex),
        shapeKey: leftShape,
      })
      continue
    }

    if (!leftShape && rightShape) {
      const cardIndex = Number(String(left).replace(/\D/g, '')) - 1
      cards.push({
        id: normalizeCardId(`card-${cardIndex + 1}`, cardIndex),
        shapeKey: rightShape,
      })
    }
  }

  return cards.sort((left, right) => left.id.localeCompare(right.id))
}

function getPhase(rawRoundInfo, roomState) {
  const roundInfo = toPlainJson(rawRoundInfo ?? {})
  const explicit = String(firstDefined(roundInfo.phase, roundInfo.round_phase, '')).trim().toLowerCase()
  if (explicit) return explicit
  if (roomState.status === 'finished') return 'finished'
  if (toBoolean(firstDefined(roundInfo.revealed, roundInfo.is_revealed))) return 'leaderboard'
  if (roomState.status === 'active') return 'playing'
  return 'idle'
}

function createDeckCache(rawRoundInfo, cache) {
  const roundInfo = toPlainJson(rawRoundInfo ?? {})
  const cardsFromList = normalizeCardsFromList(firstDefined(roundInfo.cards, roundInfo.deck))
  const cardsFromMapping = normalizeCardsFromMapping(
    firstDefined(roundInfo.cat_to_shape_mapping, roundInfo.mapping, roundInfo.card_mapping),
  )
  const normalizedCards = cardsFromList.length > 0 ? cardsFromList : cardsFromMapping

  const cards = normalizedCards.length > 0 ? normalizedCards : cache?.cards ?? DEFAULT_CARD_IDS.map((id) => ({ id, shapeKey: null, isCorrect: false }))

  return cards.map((card, index) => ({
    id: normalizeCardId(card.id, index),
    shapeKey: normalizeShapeKey(card.shapeKey),
    isCorrect: Boolean(card.isCorrect),
  }))
}

function normalizeRoundInfo(rawRoundInfo, roomState, cache) {
  const roundInfo = toPlainJson(rawRoundInfo ?? {})
  const phase = getPhase(roundInfo, roomState)
  const cards = createDeckCache(roundInfo, cache)
  const targetShapeKey = normalizeShapeKey(
    firstDefined(roundInfo.target_shape, roundInfo.targetShape, roundInfo.called_shape, roundInfo.current_shape),
  )
  const roundNumber = Number(firstDefined(roundInfo.round_number, roundInfo.current_round, roundInfo.round, roomState.roundNumber || 0))
  const startedAt = Number(firstDefined(roundInfo.round_start_timestamp, roundInfo.started_at, roundInfo.roundStartedAt, 0))
  const endsAt = Number(firstDefined(roundInfo.round_end_timestamp, roundInfo.ends_at, roundInfo.roundEndsAt, startedAt ? startedAt + 30000 : 0))
  const revealed = phase === 'leaderboard' || phase === 'finished' || toBoolean(firstDefined(roundInfo.revealed, roundInfo.is_revealed))
  const resultSummary = {
    correctUsernames: asArray(firstDefined(roundInfo.correct_usernames, roundInfo.correctUsernames, cache?.lastResult?.correctUsernames, [])),
    wrongUsernames: asArray(firstDefined(roundInfo.wrong_usernames, roundInfo.wrongUsernames, cache?.lastResult?.wrongUsernames, [])),
    removedUsernames: asArray(firstDefined(roundInfo.removed_usernames, roundInfo.removedUsernames, cache?.lastResult?.removedUsernames, [])),
  }

  return {
    roomCode: roomState.roomCode,
    roundIndex: Math.max(roundNumber - 1, 0),
    roundNumber,
    phase,
    startedAt: startedAt || 0,
    endsAt: endsAt || 0,
    revealed,
    targetShapeKey,
    cards,
    resultSummary,
  }
}

function extractReceiptError(receipt) {
  const directStderr = firstDefined(receipt?.genvm_result?.stderr, receipt?.genvmResult?.stderr, receipt?.stderr)
  if (directStderr) return String(directStderr).trim()

  const consensusLeaderReceipt = firstDefined(receipt?.consensusData?.leader_receipt, receipt?.consensus_data?.leader_receipt)
  const leaderReceipts = asArray(consensusLeaderReceipt)

  for (const leaderReceipt of leaderReceipts) {
    const stderr = firstDefined(
      leaderReceipt?.genvm_result?.stderr,
      leaderReceipt?.genvmResult?.stderr,
      leaderReceipt?.stderr,
    )
    if (stderr) return String(stderr).trim()

    const payload = firstDefined(leaderReceipt?.result?.payload, leaderReceipt?.result)
    if (payload && typeof payload === 'string') return payload
  }

  return firstDefined(
    receipt?.stderr,
    receipt?.data,
    receipt?.result_name,
    receipt?.resultName,
    receipt?.txExecutionResultName,
  )
}

function extractGenLayerErrorReason(error) {
  const receipt = firstDefined(error?.cause?.data?.receipt, error?.data?.receipt, error?.receipt)
  const receiptReason = receipt ? extractReceiptError(receipt) : null
  return firstDefined(receiptReason, error?.shortMessage, error?.message)
}

function createRelayerError(error, fallbackMessage) {
  const reason = extractGenLayerErrorReason(error)
  if (!reason) return error

  const message = String(reason).startsWith('GenLayer')
    ? String(reason)
    : `${fallbackMessage}: ${reason}`

  return Object.assign(new Error(message), { cause: error })
}

function resolveExecutionError(receipt) {
  const txExecutionResultName = firstDefined(
    receipt?.txExecutionResultName,
    receipt?.tx_execution_result_name,
  )

  if (txExecutionResultName && txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    const reason = extractReceiptError(receipt)
    throw new Error(reason ? `GenLayer execution failed: ${reason}` : 'GenLayer execution failed')
  }

  const leaderReceipts = asArray(firstDefined(receipt?.consensusData?.leader_receipt, receipt?.consensus_data?.leader_receipt))
  const hasExecutionError = leaderReceipts.some((entry) => {
    const result = String(firstDefined(entry?.execution_result, entry?.executionResult, '')).toUpperCase()
    return result === 'ERROR' || result === ExecutionResult.FINISHED_WITH_ERROR
  })

  if (hasExecutionError) {
    const reason = extractReceiptError(receipt)
    throw new Error(reason ? `GenLayer execution failed: ${reason}` : 'GenLayer execution failed')
  }
}

export class FlipitRelayer {
  constructor(config) {
    this.config = config
    this.account = createAccount(config.privateKey)
    this.client = createClient({
      chain: config.chain,
      endpoint: config.endpoint,
      account: this.account,
    })
    this.roomCache = new Map()
  }

  getRoomCache(roomCode) {
    const key = String(roomCode).toUpperCase()
    if (!this.roomCache.has(key)) {
      this.roomCache.set(key, {
        cards: DEFAULT_CARD_IDS.map((id) => ({ id, shapeKey: null, isCorrect: false })),
        guesses: new Map(),
        lastResult: {
          correctUsernames: [],
          wrongUsernames: [],
          removedUsernames: [],
        },
      })
    }
    return this.roomCache.get(key)
  }

  async read(functionName, args = []) {
    if (!functionName) {
      throw new Error('Requested contract read function is not configured')
    }

    try {
      return await this.client.readContract({
        address: this.config.contractAddress,
        functionName,
        args,
        jsonSafeReturn: true,
      })
    } catch (error) {
      console.error('[relayer] GenLayer read failed', {
        address: this.config.contractAddress,
        functionName,
        args,
        error,
      })
      throw createRelayerError(error, 'GenLayer read failed')
    }
  }

  async write(functionName, args = []) {
    if (!functionName) {
      throw new Error('Requested contract write function is not configured')
    }

    try {
      const hash = await this.client.writeContract({
        address: this.config.contractAddress,
        functionName,
        args,
        value: BigInt(0),
      })

      const receipt = await this.client.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.ACCEPTED,
      })

      resolveExecutionError(receipt)
      return { hash, receipt }
    } catch (error) {
      console.error('[relayer] GenLayer write failed', {
        address: this.config.contractAddress,
        functionName,
        args,
        error,
      })
      throw createRelayerError(error, 'GenLayer write failed')
    }
  }

  async getRoomState(roomCode) {
    const rawRoomState = await this.read(this.config.functionNames.getRoomState, [roomCode])
    return normalizeRoomState(rawRoomState)
  }

  async getLeaderboard(roomCode) {
    const rawLeaderboard = await this.read(this.config.functionNames.getLeaderboard, [roomCode])
    return normalizeLeaderboard(rawLeaderboard)
  }

  async getRoundInfo(roomCode, options = {}) {
    const roomState = options.roomState ?? (await this.getRoomState(roomCode))
    const rawRoundInfo = await this.read(this.config.functionNames.getRoundInfo, [roomCode])
    const cache = this.getRoomCache(roomCode)
    const normalized = normalizeRoundInfo(rawRoundInfo, roomState, cache)
    cache.cards = normalized.cards
    return options.privateView ? normalized : this.toPublicRoundInfo(normalized)
  }

  toPublicRoundInfo(roundInfo) {
    const cards = roundInfo.cards.map((card) => ({
      id: card.id,
      revealedShapeKey: roundInfo.revealed ? card.shapeKey : null,
      isCorrect: roundInfo.revealed ? card.isCorrect : false,
    }))

    return {
      ...roundInfo,
      cards,
    }
  }

  async getSnapshot(roomCode, options = {}) {
    const roomState = await this.getRoomState(roomCode)
    const [roundInfo, leaderboard] = await Promise.all([
      this.getRoundInfo(roomCode, { roomState, privateView: options.privateRoundInfo === true }),
      this.getLeaderboard(roomCode),
    ])

    return {
      roomState,
      roundInfo,
      leaderboard,
    }
  }

  async getRoundMapping(roomCode) {
    const rawMapping = await this.read(this.config.functionNames.getRoundMapping, [roomCode])
    const payload = toPlainJson(rawMapping ?? {})
    const mappingSource = firstDefined(
      payload.cat_to_shape_mapping,
      payload.catToShapeMapping,
      payload.current_cat_map,
      payload.currentCatMap,
      payload.mapping,
      payload,
    )

    const mapping = {}
    const cards = normalizeCardsFromMapping(mappingSource)

    for (const card of cards) {
      if (card.id && card.shapeKey) {
        mapping[String(card.id)] = String(card.shapeKey)
      }
    }

    for (const [key, value] of Object.entries(asObject(mappingSource) ?? {})) {
      const normalizedShape = normalizeShapeKey(value)
      if (normalizedShape) {
        mapping[String(key)] = normalizedShape
      }
    }

    return {
      roomCode: String(firstDefined(payload.room_code, payload.roomCode, roomCode)).toUpperCase(),
      roundNumber: Number(firstDefined(payload.round_number, payload.roundNumber, payload.current_round, 0)),
      mapping,
    }
  }

  async resolveCard(roomCode, cardId) {
    const { mapping, roundNumber } = await this.getRoundMapping(roomCode)
    const shape = normalizeShapeKey(mapping[String(cardId)])

    if (!shape) {
      throw new Error('Unable to resolve the selected card for this round')
    }

    return {
      roomCode: String(roomCode).toUpperCase(),
      roundNumber,
      cardId: String(cardId),
      shape,
    }
  }

  async createRoom(roomCode, hostUsername) {
    await this.write(this.config.functionNames.createRoom, [roomCode, hostUsername])
    return this.getSnapshot(roomCode)
  }

  async joinRoom(roomCode, username) {
    await this.write(this.config.functionNames.joinRoom, [roomCode, username])
    return this.getSnapshot(roomCode)
  }

  async startGame(roomCode) {
    await this.write(this.config.functionNames.startGame, [roomCode])
    return this.getSnapshot(roomCode)
  }

  async submitGuess({ roomCode, username, selectedCardId, guessedShape, guessTimestamp }) {
    const cache = this.getRoomCache(roomCode)
    const resolvedCard = selectedCardId ? await this.resolveCard(roomCode, selectedCardId) : null
    const resolvedShape = normalizeShapeKey(resolvedCard?.shape ?? guessedShape)

    if (!resolvedShape) {
      throw new Error('Unable to resolve the selected card for this round')
    }

    cache.guesses.set(sanitizeName(username), {
      username,
      selectedCardId,
      guessedShape: resolvedShape,
      guessTimestamp: Number(guessTimestamp),
    })

    await this.write(this.config.functionNames.submitGuess, [roomCode, username, resolvedShape, Number(guessTimestamp)])
    return this.getSnapshot(roomCode)
  }

  async revealRound(roomCode) {
    const beforeRoomState = await this.getRoomState(roomCode)
    const beforeRoundInfo = await this.getRoundInfo(roomCode, { roomState: beforeRoomState, privateView: true })
    const previousStatuses = new Map(beforeRoomState.players.map((player) => [sanitizeName(player.username), player.status]))
    const cache = this.getRoomCache(roomCode)
    const guesses = [...cache.guesses.values()]

    await this.write(this.config.functionNames.revealRound, [roomCode])

    const snapshot = await this.getSnapshot(roomCode)
    const targetShapeKey = beforeRoundInfo.targetShapeKey
    const removedUsernames = snapshot.roomState.players
      .filter((player) => player.status === 'removed' && previousStatuses.get(sanitizeName(player.username)) !== 'removed')
      .map((player) => player.username)

    cache.lastResult = {
      correctUsernames: guesses
        .filter((guess) => normalizeShapeKey(guess.guessedShape) === targetShapeKey)
        .map((guess) => guess.username),
      wrongUsernames: guesses
        .filter((guess) => normalizeShapeKey(guess.guessedShape) !== targetShapeKey)
        .map((guess) => guess.username),
      removedUsernames,
    }
    cache.guesses.clear()

    return {
      ...snapshot,
      roundInfo: {
        ...snapshot.roundInfo,
        resultSummary: cache.lastResult,
      },
    }
  }

  async endGame(roomCode) {
    await this.write(this.config.functionNames.endGame, [roomCode])
    return this.getSnapshot(roomCode)
  }

  async playAgain(roomCode) {
    await this.write(this.config.functionNames.playAgain, [roomCode])
    const cache = this.getRoomCache(roomCode)
    cache.guesses.clear()
    cache.lastResult = {
      correctUsernames: [],
      wrongUsernames: [],
      removedUsernames: [],
    }
    return this.getSnapshot(roomCode)
  }

  async leaveRoom(roomCode, username) {
    const functionName = this.config.functionNames.leaveRoom
    if (functionName) {
      await this.write(functionName, [roomCode, username])
    }

    const cache = this.getRoomCache(roomCode)
    cache.guesses.delete(sanitizeName(username))
    return { ok: true }
  }
}
