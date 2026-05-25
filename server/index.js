import cors from 'cors'
import express from 'express'
import { getConfig } from './config.js'
import { FlipitRelayer } from './flipitRelayer.js'

const config = getConfig()
const relayer = new FlipitRelayer(config)
const app = express()
const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/
const configuredCorsOrigins = config.corsOrigin
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

function isLocalDevOrigin(origin) {
  try {
    const url = new URL(origin)
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function allowCorsOrigin(origin, callback) {
  if (!origin || configuredCorsOrigins.includes('*') || configuredCorsOrigins.includes(origin) || isLocalDevOrigin(origin)) {
    callback(null, true)
    return
  }

  callback(new Error(`CORS origin not allowed: ${origin}`))
}

app.use(
  cors({
    origin: allowCorsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  }),
)
app.use(express.json())
app.use('/api', (req, _res, next) => {
  console.log(`[relayer] ${req.method} ${req.path}`, {
    query: req.query,
    body: req.body,
  })
  next()
})

function requireBody(field, body) {
  const value = body?.[field]
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required field: ${field}`)
  }
  return value
}

function normalizeRoomCode(value) {
  const roomCode = String(value ?? '').trim().toUpperCase()
  if (!ROOM_CODE_PATTERN.test(roomCode)) {
    throw new Error('Room code must be exactly 6 letters or numbers')
  }
  return roomCode
}

function getRoomCode(req) {
  const roomCode = req.query.room_code ?? req.query.roomCode
  if (!roomCode) {
    throw new Error('Missing room_code query parameter')
  }
  return normalizeRoomCode(roomCode)
}

function getCardId(req) {
  const cardId = req.query.card_id ?? req.query.cardId
  if (!cardId) {
    throw new Error('Missing card_id query parameter')
  }
  return String(cardId)
}

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      const payload = await handler(req, res)
      if (!res.headersSent) {
        res.json(payload)
      }
    } catch (error) {
      console.error(`[relayer] ${req.method} ${req.path} failed`, error)
      const isClientError = error.message?.includes('Missing') || error.message?.includes('Room code')
      const status = isClientError ? 400 : 500
      res.status(status).json({
        error: error.message ?? 'Unknown relayer error',
      })
    }
  }
}

app.post(
  '/api/create-room',
  asyncRoute(async (req) => {
    const roomCode = normalizeRoomCode(requireBody('room_code', req.body))
    const hostUsername = String(requireBody('host_username', req.body))
    return relayer.createRoom(roomCode, hostUsername)
  }),
)

app.post(
  '/api/join-room',
  asyncRoute(async (req) => {
    const roomCode = normalizeRoomCode(requireBody('room_code', req.body))
    const username = String(requireBody('username', req.body))
    return relayer.joinRoom(roomCode, username)
  }),
)

app.post(
  '/api/start-game',
  asyncRoute(async (req) => {
    const roomCode = normalizeRoomCode(requireBody('room_code', req.body))
    return relayer.startGame(roomCode)
  }),
)

app.post(
  '/api/submit-guess',
  asyncRoute(async (req) => {
    const roomCode = normalizeRoomCode(requireBody('room_code', req.body))
    const username = String(requireBody('username', req.body))
    const guessTimestamp = Number(requireBody('guess_timestamp', req.body))
    return relayer.submitGuess({
      roomCode,
      username,
      selectedCardId: req.body.selected_card_id ? String(req.body.selected_card_id) : null,
      guessedShape: req.body.guessed_shape ? String(req.body.guessed_shape) : null,
      guessTimestamp,
    })
  }),
)

app.post(
  '/api/reveal-round',
  asyncRoute(async (req) => {
    const roomCode = normalizeRoomCode(requireBody('room_code', req.body))
    return relayer.revealRound(roomCode)
  }),
)

app.post(
  '/api/end-game',
  asyncRoute(async (req) => {
    const roomCode = normalizeRoomCode(requireBody('room_code', req.body))
    return relayer.endGame(roomCode)
  }),
)

app.post(
  '/api/play-again',
  asyncRoute(async (req) => {
    const roomCode = normalizeRoomCode(requireBody('room_code', req.body))
    return relayer.playAgain(roomCode)
  }),
)

app.post(
  '/api/leave-room',
  asyncRoute(async (req) => {
    const roomCode = normalizeRoomCode(requireBody('room_code', req.body))
    const username = String(requireBody('username', req.body))
    return relayer.leaveRoom(roomCode, username)
  }),
)

app.get(
  '/api/room-state',
  asyncRoute(async (req) => {
    const roomCode = getRoomCode(req)
    return relayer.getRoomState(roomCode)
  }),
)

app.get(
  '/api/leaderboard',
  asyncRoute(async (req) => {
    const roomCode = getRoomCode(req)
    return relayer.getLeaderboard(roomCode)
  }),
)

app.get(
  '/api/round-info',
  asyncRoute(async (req) => {
    const roomCode = getRoomCode(req)
    return relayer.getRoundInfo(roomCode)
  }),
)

app.get(
  '/api/resolve-card',
  asyncRoute(async (req) => {
    const roomCode = getRoomCode(req)
    const cardId = getCardId(req)
    return relayer.resolveCard(roomCode, cardId)
  }),
)

app.listen(config.port, () => {
  console.log(`FlipIt relayer listening on http://localhost:${config.port}`)
  console.log(`[relayer] CORS origin: ${config.corsOrigin}`)
})
