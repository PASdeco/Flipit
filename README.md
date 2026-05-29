# FlipIt

FlipIt is a browser-based multiplayer guessing game built for GenLayer Studionet. Players create or join a room, sign their own actions with MetaMask, and play through ten on-chain rounds while the UI stays in sync by polling contract state.

This version keeps the app simple:

- no backend server
- no relayer
- no Supabase
- no wagmi
- no MetaMask Snaps
- wallet connection with `ethers`
- GenLayer contract reads and writes with `genlayer-js`

## Current Architecture

All game state lives on-chain in the FlipIt contract.

- Wallet connection: `ethers`
- Contract interaction: `genlayer-js`
- Frontend: React + Vite
- Styling and animation: existing in-app UI layer
- Audio: `tone`

The frontend data layer is split across:

- [src/lib/wallet.js](/c:/Vibe%20code/flipit/src/lib/wallet.js)
- [src/lib/genlayer.js](/c:/Vibe%20code/flipit/src/lib/genlayer.js)
- [src/lib/api.js](/c:/Vibe%20code/flipit/src/lib/api.js)
- [contract/flipit.py](/c:/Vibe%20code/flipit/contract/flipit.py)

## Gameplay Flow

1. A host creates a room and signs `create_room`.
2. Players join with a username and sign `join_room`.
3. The lobby polls chain state until the host starts the game.
4. Each round shows one target shape and five hidden cards.
5. Players sign `submit_guess` before the timer ends.
6. The host reveals the round, the leaderboard updates, and the next round continues.
7. After the final round, the game ends and players can replay.

## On-Chain Read and Write Model

Every player signs their own transactions from the browser.

Writes currently used by the app:

- `create_room`
- `join_room`
- `start_game`
- `submit_guess`
- `reveal_round`
- `advance_round`
- `end_game`
- `play_again`

Reads currently used by the app:

- `get_room_state`
- `get_round_info`
- `get_leaderboard`

Polling strategy:

- lobby: every 3 seconds
- active round: every 2 seconds
- reveal and leaderboard windows: every 1 second

## Environment

Create a `.env` file with:

```bash
VITE_CONTRACT_ADDRESS=your_contract_address
VITE_GENLAYER_RPC_URL=https://studio.genlayer.com/api
VITE_GENLAYER_CHAIN_ID=61999
```

You can also start from [.env.example](/c:/Vibe%20code/flipit/.env.example).

## Getting Started

Install dependencies:

```bash
npm install
```

Run the app locally:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

Run the linter:

```bash
npm run lint
```

Preview the production build:

```bash
npm run preview
```

## Testing on Another Device

To open the app from your phone on the same Wi-Fi network, start Vite with a public host:

```bash
npm run dev -- --host 0.0.0.0 --port 4173
```

Then open:

```text
http://YOUR_LOCAL_IP:4173/
```

If you want a production-style preview on your phone:

```bash
npm run preview -- --host 0.0.0.0 --port 4173
```

## Wallet and Network Notes

- MetaMask is required
- the app switches users to GenLayer Studionet
- every state-changing action requires a wallet signature
- read calls do not require signing

## Project Status

This repository contains the current on-chain browser integration for FlipIt. The UI, styling, animations, and game presentation are already in place; the active work in this version is focused on the wallet and GenLayer data layer.
