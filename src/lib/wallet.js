import { ethers } from 'ethers'

const chainId = Number(import.meta.env.VITE_GENLAYER_CHAIN_ID ?? 61999)
const rpcUrl = String(import.meta.env.VITE_GENLAYER_RPC_URL ?? 'https://studio.genlayer.com/api').trim()

const chainConfig = {
  chainId: `0x${chainId.toString(16)}`,
  chainName: 'GenLayer Studio Network',
  nativeCurrency: {
    name: 'GEN Token',
    symbol: 'GEN',
    decimals: 18,
  },
  rpcUrls: [rpcUrl],
}

let walletAddress = ''
let browserProvider = null
const listeners = new Set()
let watching = false

function getEthereum() {
  return typeof window !== 'undefined' ? window.ethereum ?? null : null
}

export function getInjectedProvider() {
  const ethereum = getEthereum()
  if (!ethereum) {
    throw new Error('Please install MetaMask to play FlipIt')
  }
  return ethereum
}

function emitWalletChange() {
  for (const listener of listeners) {
    listener(walletAddress)
  }
}

function walletErrorMessage(error) {
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

  return message || 'Wallet request failed.'
}

function ensureWatchers() {
  if (watching) return
  const ethereum = getEthereum()
  if (!ethereum?.on) return

  ethereum.on('accountsChanged', (accounts) => {
    walletAddress = Array.isArray(accounts) && accounts[0] ? String(accounts[0]).toLowerCase() : ''
    emitWalletChange()
  })

  ethereum.on('disconnect', () => {
    walletAddress = ''
    emitWalletChange()
  })

  watching = true
}

async function ensureStudionet(provider) {
  const ethereum = getEthereum()
  if (!ethereum?.request) {
    throw new Error('Please install MetaMask to play FlipIt')
  }

  const currentChainId = await ethereum.request({ method: 'eth_chainId' })
  if (String(currentChainId).toLowerCase() === chainConfig.chainId.toLowerCase()) {
    return provider
  }

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainConfig.chainId }],
    })
  } catch (error) {
    const code = Number(error?.code ?? error?.data?.originalError?.code)
    if (code !== 4902) {
      throw error
    }

    await ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [chainConfig],
    })
  }

  return provider
}

export function getConnectedWalletAddress() {
  return walletAddress
}

export function isWalletConnected() {
  return Boolean(walletAddress)
}

export async function ensureWalletConnected() {
  const ethereum = getEthereum()
  if (!ethereum) {
    throw new Error('Please install MetaMask to play FlipIt')
  }

  try {
    const provider = browserProvider ?? new ethers.BrowserProvider(ethereum)
    browserProvider = provider
    const accounts = await provider.send('eth_requestAccounts', [])
    const nextAddress = Array.isArray(accounts) && accounts[0] ? String(accounts[0]).toLowerCase() : ''

    if (!nextAddress) {
      throw new Error('Wallet connected, but no account was returned.')
    }

    await ensureStudionet(provider)
    walletAddress = nextAddress
    ensureWatchers()
    emitWalletChange()
    return walletAddress
  } catch (error) {
    throw new Error(walletErrorMessage(error), { cause: error })
  }
}

export async function getConnectedWalletProvider() {
  if (!browserProvider) {
    const ethereum = getEthereum()
    if (!ethereum) {
      throw new Error('Please install MetaMask to play FlipIt')
    }
    browserProvider = new ethers.BrowserProvider(ethereum)
  }

  if (!walletAddress) {
    await ensureWalletConnected()
  }

  await ensureStudionet(browserProvider)
  return browserProvider
}

export async function getConnectedSigner() {
  const provider = await getConnectedWalletProvider()
  return provider.getSigner()
}

export async function disconnectWallet() {
  walletAddress = ''
  emitWalletChange()
}

export function watchWalletAddress(onChange) {
  listeners.add(onChange)
  ensureWatchers()
  onChange(walletAddress)
  return () => listeners.delete(onChange)
}
