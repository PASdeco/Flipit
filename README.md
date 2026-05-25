# FlipIt

## Environment Variables

Copy `.env.example` to `.env` and set the following values:

- `RELAYER_PRIVATE_KEY`
  Private key of the funded relayer wallet from GenLayer Studio. Get it by creating a wallet in GenLayer Studio and copying the private key. Fund it using the built-in faucet button in the account selector.

- `CONTRACT_ADDRESS`
  The deployed FlipIt contract address on Studionet. You get this after running `npm run contract:deploy`.

- `GENLAYER_RPC_URL`
  Studionet RPC endpoint. Always `https://studio.genlayer.com/api`.

- `GENLAYER_CHAIN_ID`
  Studionet chain ID. Always `61999`.

- `PORT`
  The port the relayer backend runs on. Default is `3001`.
