function normalizeApiBase(rawBase) {
  const trimmedBase = String(rawBase ?? '').trim().replace(/\/+$/, '')

  if (!trimmedBase) {
    return import.meta.env.PROD ? null : 'http://localhost:3001/api'
  }

  return trimmedBase.endsWith('/api') ? trimmedBase : `${trimmedBase}/api`
}

const API_BASE = normalizeApiBase(import.meta.env.VITE_RELAYER_URL)

async function request(path, options = {}) {
  if (!API_BASE) {
    throw new Error('Missing VITE_RELAYER_URL. Deploy the relayer to a public URL and set it in Vercel.')
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  })
    .catch((error) => {
      throw new Error(`Unable to reach FlipIt relayer at ${API_BASE}. Check that the relayer is deployed and CORS allows this site. ${error.message}`)
    })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`)
  }

  return payload
}

function roomQuery(roomCode) {
  return `?room_code=${encodeURIComponent(roomCode)}`
}

export const api = {
  createRoom({ roomCode, hostUsername }) {
    return request('/create-room', {
      method: 'POST',
      body: JSON.stringify({
        room_code: roomCode,
        host_username: hostUsername,
      }),
    })
  },

  joinRoom({ roomCode, username }) {
    return request('/join-room', {
      method: 'POST',
      body: JSON.stringify({
        room_code: roomCode,
        username,
      }),
    })
  },

  startGame({ roomCode }) {
    return request('/start-game', {
      method: 'POST',
      body: JSON.stringify({
        room_code: roomCode,
      }),
    })
  },

  submitGuess({ roomCode, username, selectedCardId, guessedShape, guessTimestamp }) {
    return request('/submit-guess', {
      method: 'POST',
      body: JSON.stringify({
        room_code: roomCode,
        username,
        selected_card_id: selectedCardId,
        guessed_shape: guessedShape,
        guess_timestamp: guessTimestamp,
      }),
    })
  },

  revealRound({ roomCode }) {
    return request('/reveal-round', {
      method: 'POST',
      body: JSON.stringify({
        room_code: roomCode,
      }),
    })
  },

  endGame({ roomCode }) {
    return request('/end-game', {
      method: 'POST',
      body: JSON.stringify({
        room_code: roomCode,
      }),
    })
  },

  playAgain({ roomCode }) {
    return request('/play-again', {
      method: 'POST',
      body: JSON.stringify({
        room_code: roomCode,
      }),
    })
  },

  leaveRoom({ roomCode, username }) {
    return request('/leave-room', {
      method: 'POST',
      body: JSON.stringify({
        room_code: roomCode,
        username,
      }),
    })
  },

  getRoomState(roomCode) {
    return request(`/room-state${roomQuery(roomCode)}`)
  },

  getLeaderboard(roomCode) {
    return request(`/leaderboard${roomQuery(roomCode)}`)
  },

  getRoundInfo(roomCode) {
    return request(`/round-info${roomQuery(roomCode)}`)
  },
}
