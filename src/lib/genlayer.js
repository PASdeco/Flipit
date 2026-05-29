import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { ExecutionResult, TransactionStatus } from 'genlayer-js/types'
import { getConnectedWalletAddress, getInjectedProvider } from './wallet'

const rpcUrl = String(import.meta.env.VITE_GENLAYER_RPC_URL ?? 'https://studio.genlayer.com/api').trim()
const contractAddress = String(import.meta.env.VITE_CONTRACT_ADDRESS ?? '').trim()

function requireContractAddress() {
  if (!contractAddress || contractAddress === 'your_contract_address') {
    throw new Error('Missing VITE_CONTRACT_ADDRESS in .env')
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    throw new Error('VITE_CONTRACT_ADDRESS must be a deployed 0x contract address.')
  }

  return contractAddress
}

function rpcErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const normalized = message.toLowerCase()
  const code = Number(error?.code ?? error?.info?.error?.code)

  if (code === 4001 || normalized.includes('user rejected') || normalized.includes('user denied')) {
    return 'Transaction cancelled'
  }

  if (normalized.includes('already processing') || normalized.includes('request already pending')) {
    return 'Your wallet already has a pending request. Finish it in MetaMask and try again.'
  }

  if (normalized.includes('wallet not installed') || normalized.includes('no injected provider') || normalized.includes('not installed')) {
    return 'Please install MetaMask to play FlipIt'
  }

  return message || 'GenLayer request failed.'
}

function parseJsonResult(value) {
  if (typeof value !== 'string') {
    return value
  }

  const text = value.trim()
  if (!text) {
    return value
  }

  if (!text.startsWith('{') && !text.startsWith('[') && text !== 'null' && text !== 'true' && text !== 'false') {
    return value
  }

  try {
    return JSON.parse(text)
  } catch {
    return value
  }
}

function createReadClient() {
  return createClient({
    chain: studionet,
    endpoint: rpcUrl,
  })
}

function createWriteClient() {
  const address = getConnectedWalletAddress()
  if (!address) {
    throw new Error('Connect your wallet before sending GenLayer transactions.')
  }

  return createClient({
    chain: studionet,
    endpoint: rpcUrl,
    account: address,
    provider: getInjectedProvider(),
  })
}

async function readContract(functionName, args = []) {
  try {
    const client = createReadClient()
    const result = await client.readContract({
      address: requireContractAddress(),
      functionName,
      args,
    })

    return parseJsonResult(result)
  } catch (error) {
    throw new Error(rpcErrorMessage(error), { cause: error })
  }
}

async function readTraceError(client, hash) {
  try {
    const trace = await client.debugTraceTransaction({ hash })
    const message = String(trace?.stderr ?? '').trim()
    if (!message) return ''

    const lines = message.split('\n').map((line) => line.trim()).filter(Boolean)
    return lines.at(-1) ?? message
  } catch {
    return ''
  }
}

export async function sendWrite(functionName, args = []) {
  const client = createWriteClient()

  try {
    const hash = await client.writeContract({
      address: requireContractAddress(),
      functionName,
      args,
      value: 0n,
    })

    const receipt = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.ACCEPTED,
    })

    if (receipt?.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
      const traceError = await readTraceError(client, hash)
      throw new Error(traceError ? `GenLayer execution failed: ${traceError}` : 'GenLayer execution failed')
    }

    return { hash, receipt }
  } catch (error) {
    throw new Error(rpcErrorMessage(error), { cause: error })
  }
}

export async function createRoomOnChain({ roomCode, hostAddress, hostUsername, roundSequence, initialMapping }) {
  return sendWrite('create_room', [roomCode, hostAddress, hostUsername, JSON.stringify(roundSequence), JSON.stringify(initialMapping)])
}

export async function joinRoomOnChain({ roomCode, username, walletAddress }) {
  return sendWrite('join_room', [roomCode, username, walletAddress])
}

export async function startGameOnChain({ roomCode, startedAt }) {
  return sendWrite('start_game', [roomCode, Number(startedAt)])
}

export async function submitGuessOnChain({ roomCode, username, guessedShape, timestamp }) {
  return sendWrite('submit_guess', [roomCode, username, guessedShape, Number(timestamp)])
}

export async function revealRoundOnChain({ roomCode }) {
  return sendWrite('reveal_round', [roomCode])
}

export async function advanceRoundOnChain({ roomCode, initialMapping, startedAt }) {
  return sendWrite('advance_round', [roomCode, JSON.stringify(initialMapping), Number(startedAt)])
}

export async function endGameOnChain({ roomCode }) {
  return sendWrite('end_game', [roomCode])
}

export async function playAgainOnChain({ roomCode, roundSequence, initialMapping }) {
  return sendWrite('play_again', [roomCode, JSON.stringify(roundSequence), JSON.stringify(initialMapping)])
}

export async function getRoomStateOnChain(roomCode) {
  return readContract('get_room_state', [roomCode])
}

export async function getRoundInfoOnChain(roomCode) {
  return readContract('get_round_info', [roomCode])
}

export async function getLeaderboardOnChain(roomCode) {
  return readContract('get_leaderboard', [roomCode])
}
