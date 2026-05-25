import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAccount, createClient } from 'genlayer-js'
import { TransactionStatus } from 'genlayer-js/types'
import { studionet } from 'genlayer-js/chains'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing ${name} in .env`)
  }
  return value
}

function extractContractAddress(receipt) {
  const decodedAddress = receipt?.txDataDecoded?.contractAddress
  const dataAddress = receipt?.data?.contractAddress
  const directAddress = receipt?.contractAddress
  const address = decodedAddress ?? dataAddress ?? directAddress

  if (!address) {
    throw new Error('Unable to determine deployed contract address from receipt')
  }

  return String(address)
}

async function main() {
  const privateKey = requireEnv('RELAYER_PRIVATE_KEY')
  const rpcUrl = requireEnv('GENLAYER_RPC_URL')
  const account = createAccount(privateKey)
  const client = createClient({
    chain: studionet,
    endpoint: rpcUrl,
    account,
  })

  const contractPath = path.join(__dirname, 'flipit.py')
  const code = fs.readFileSync(contractPath)

  console.log(`Deploying FlipIt contract to Studionet from relayer ${account.address}...`)

  const hash = await client.deployContract({
    code: new Uint8Array(code),
    args: [],
  })

  console.log(`Deployment tx hash: ${hash}`)

  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
  })

  const address = extractContractAddress(receipt)
  console.log(`CONTRACT_ADDRESS=${address}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
