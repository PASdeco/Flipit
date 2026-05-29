# FlipIt

FlipIt now uses a browser-only on-chain integration layer:

- Every player signs their own transactions
- Wallet connection uses `ethers`
- Read calls use direct `gen_call` JSON-RPC requests to Studionet
- No Supabase, relayer, backend server, wagmi, or MetaMask Snaps

## Environment

Set these values in `.env`:

```bash
VITE_CONTRACT_ADDRESS=your_contract_address
VITE_GENLAYER_RPC_URL=https://studio.genlayer.com/api
VITE_GENLAYER_CHAIN_ID=61999
```

## Development

```bash
npm install
npm run dev
```

## Contract

The on-chain game state contract lives in [contract/flipit.py](</c:/Vibe code/flipit/contract/flipit.py>).
