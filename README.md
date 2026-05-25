# FlipIt

FlipIt is a fast multiplayer card-flip guessing game powered by a GenLayer smart contract. Players create or join rooms, race through timed rounds, pick the hidden matching card, and climb the leaderboard while the contract keeps room state, scoring, round flow, and anti-cheat checks on-chain.

## Features

- Multiplayer room creation and joining with shareable six-character room codes
- GenLayer smart contract-backed game state
- Timed card-flip rounds with randomized card mappings
- Score tracking, streaks, speed bonuses, and final leaderboard
- Anti-cheat detection for suspicious perfect streaks and unrealistically fast responses
- Express relayer for contract reads/writes
- React + Vite frontend with music, sound effects, lobby flow, and live polling

## Tech Stack

- React 19
- Vite
- Tailwind CSS
- Express
- GenLayer JS
- GenLayer Python smart contract
- Tone.js

## Project Structure

```text
flipit/
  contract/        GenLayer smart contract and deployment script
  server/          Express relayer API for frontend-to-contract calls
  src/             React game frontend
  public/          Static assets, audio, backgrounds, mascots
  dist/            Production build output
```

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file:

```bash
cp .env.example .env
```

Then fill in:

```env
RELAYER_PRIVATE_KEY=your_funded_genlayer_private_key
CONTRACT_ADDRESS=your_deployed_flipit_contract_address
GENLAYER_RPC_URL=https://studio.genlayer.com/api
GENLAYER_CHAIN_ID=61999
PORT=3001
VITE_RELAYER_URL=http://localhost:3001
CORS_ORIGIN=http://localhost:5173
```

Important: never commit your real `.env` file or private key.

## Smart Contract

The contract lives in `contract/flipit.py`. It manages:

- Authorized relayer validation
- Room creation and joining
- Player roster and host tracking
- Round sequencing and card mapping
- Guess submission
- Reveal logic
- Scoring and streaks
- Anti-cheat removal
- Leaderboard and game reset

Deploy the contract with:

```bash
npm run contract:deploy
```

After deployment, copy the printed `CONTRACT_ADDRESS` into `.env`.

## Running Locally

Start the relayer API:

```bash
npm run relayer:dev
```

In another terminal, start the frontend:

```bash
npm run dev
```

Open the Vite URL in your browser, usually:

```text
http://localhost:5173
```

## Deploying

The Vercel frontend needs a public relayer URL. The relayer cannot be replaced by the static Vercel build because it uses `RELAYER_PRIVATE_KEY` to sign GenLayer transactions.

Deploy `server/index.js` to a Node host such as Render, Railway, Fly.io, a VPS, or another service that can run a long-lived Express server. Set these environment variables on that host:

```env
RELAYER_PRIVATE_KEY=your_funded_genlayer_private_key
CONTRACT_ADDRESS=your_deployed_flipit_contract_address
GENLAYER_RPC_URL=https://studio.genlayer.com/api
GENLAYER_CHAIN_ID=61999
PORT=3001
CORS_ORIGIN=https://your-vercel-app.vercel.app
```

Then set this environment variable in Vercel before rebuilding the frontend:

```env
VITE_RELAYER_URL=https://your-public-relayer-url
```

For local development, `VITE_RELAYER_URL=http://localhost:3001` is fine. For a deployed Vercel app, do not use `localhost`, because your users' browsers will try to connect to their own machines.

## Relayer API

The frontend talks to the Express relayer instead of calling the contract directly from the browser. Main routes:

- `POST /api/create-room`
- `POST /api/join-room`
- `POST /api/start-game`
- `POST /api/submit-guess`
- `POST /api/reveal-round`
- `POST /api/end-game`
- `POST /api/play-again`
- `POST /api/leave-room`
- `GET /api/room-state`
- `GET /api/round-info`
- `GET /api/leaderboard`

Room codes must be exactly six letters or numbers.

## Useful Scripts

```bash
npm run dev              # Start frontend dev server
npm run relayer:dev      # Start Express relayer
npm run contract:deploy  # Deploy GenLayer contract
npm run build            # Build frontend for production
npm run preview          # Preview production build
npm run lint             # Run ESLint
```

## Development Notes

- The relayer wallet must match the address authorized by the deployed contract.
- The relayer private key must be funded on GenLayer Studionet.
- If the frontend shows `Failed to fetch`, check that the relayer is running on `PORT` and that CORS allows the frontend origin.
- If contract execution fails, inspect the GenVM stderr. Most contract assertions are intentionally descriptive.

## License

This project is currently unlicensed. Add a license before publishing for public reuse.
