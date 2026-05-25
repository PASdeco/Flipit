import 'dotenv/config'
import { studionet } from 'genlayer-js/chains'

const DEFAULT_RPC_URL = 'https://studio.genlayer.com/api'
const DEFAULT_CHAIN_ID = 61999

function getOptionalFunctionName(name, fallback) {
  const value = process.env[name]
  if (value === undefined) return fallback
  if (!value.trim()) return null
  return value.trim()
}

export function getConfig() {
  const rpcUrl = process.env.GENLAYER_RPC_URL?.trim() || DEFAULT_RPC_URL
  const chainId = Number(process.env.GENLAYER_CHAIN_ID ?? DEFAULT_CHAIN_ID)
  const contractAddress = process.env.CONTRACT_ADDRESS?.trim() || process.env.GENLAYER_CONTRACT_ADDRESS?.trim()
  const privateKey = process.env.RELAYER_PRIVATE_KEY?.trim() || process.env.GENLAYER_PRIVATE_KEY?.trim()
  const corsOrigin = process.env.CORS_ORIGIN?.trim() || 'http://localhost:5173'

  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error('GENLAYER_CHAIN_ID must be a positive number')
  }

  if (!contractAddress) {
    throw new Error('Missing CONTRACT_ADDRESS in .env')
  }

  if (!privateKey) {
    throw new Error('Missing RELAYER_PRIVATE_KEY in .env')
  }

  return {
    port: Number(process.env.PORT ?? 3001),
    corsOrigin,
    endpoint: rpcUrl,
    chain: {
      ...studionet,
      id: chainId,
      rpcUrls: {
        ...studionet.rpcUrls,
        default: {
          ...studionet.rpcUrls.default,
          http: [rpcUrl],
        },
      },
    },
    contractAddress,
    privateKey,
    functionNames: {
      createRoom: getOptionalFunctionName('GENLAYER_FN_CREATE_ROOM', 'create_room'),
      joinRoom: getOptionalFunctionName('GENLAYER_FN_JOIN_ROOM', 'join_room'),
      startGame: getOptionalFunctionName('GENLAYER_FN_START_GAME', 'start_game'),
      submitGuess: getOptionalFunctionName('GENLAYER_FN_SUBMIT_GUESS', 'submit_guess'),
      revealRound: getOptionalFunctionName('GENLAYER_FN_REVEAL_ROUND', 'reveal_round'),
      endGame: getOptionalFunctionName('GENLAYER_FN_END_GAME', 'end_game'),
      playAgain: getOptionalFunctionName('GENLAYER_FN_PLAY_AGAIN', 'play_again'),
      leaveRoom: getOptionalFunctionName('GENLAYER_FN_LEAVE_ROOM', 'leave_room'),
      getRoomState: getOptionalFunctionName('GENLAYER_FN_GET_ROOM_STATE', 'get_room_state'),
      getLeaderboard: getOptionalFunctionName('GENLAYER_FN_GET_LEADERBOARD', 'get_leaderboard'),
      getRoundInfo: getOptionalFunctionName('GENLAYER_FN_GET_ROUND_INFO', 'get_round_info'),
      getRoundMapping: getOptionalFunctionName('GENLAYER_FN_GET_ROUND_MAPPING', 'get_round_mapping'),
    },
  }
}
