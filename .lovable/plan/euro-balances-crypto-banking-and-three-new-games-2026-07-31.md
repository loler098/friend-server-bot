# Euro balances, crypto banking, and three new games

## What changes

### 1. Money becomes euros (with cents)
- Balances are stored in cents and always shown as `€12.50`.
- Existing balances are converted 1 coin = €1 (so 1000 becomes €1000.00).
- Every message that said "coins" now says euros.

### 2. Privacy rules for command replies
- **Public in the channel:** all games (`/coinflip`, `/slots`, `/blackjack`, `/mines`, `/towers`, `/upgrader`) — everyone sees the bet, the result, and the new balance.
- **Private (only the player sees it):** `/balance`, `/deposit`, `/withdraw`, `/leaderboard`, `/register`, `/daily`.

### 3. Three new games
- **Mines** — `/mines bet:<€> mines:<1-24> picks:<n>`. A 5x5 grid, you choose how many bombs and how many safe tiles to auto-reveal. Payout scales with risk; hitting a bomb loses the bet. Result is drawn as a grid in the channel.
- **Towers** — `/towers bet:<€> difficulty:<easy|medium|hard> floors:<1-8>`. Climb floors picking one safe tile per row; each cleared floor multiplies the bet. One wrong step ends the run.
- **Upgrader** — `/upgrader bet:<€> multiplier:<1.5x|2x|5x|10x|50x>`. A single roll with a win chance derived from the chosen multiplier (with house edge). Win pays bet x multiplier, lose takes the bet.

### 4. Crypto deposits (auto-detected)
- You provide one receiving wallet address per supported coin (BTC, ETH, LTC, USDT-TRC20 to start).
- `/deposit coin:<coin>` privately shows the address plus a **unique deposit tag**: a tiny unique cents amount added to the amount the player sends, so incoming transactions can be matched to that player automatically.
- A background checker runs every minute against public blockchain explorers, looks at incoming transactions to your addresses, and credits the matching player once the transaction has enough confirmations. Each transaction is credited only once.
- If an amount can't be matched, the player can run `/deposit tx:<hash>` to claim it; the bot verifies the transaction on-chain before crediting.
- The player sees the credit reflected in `/balance` as soon as it confirms, and the bot DMs them a confirmation.

### 5. Crypto withdrawals
- `/withdraw address:<wallet> coin:<coin> amount:<€>` — validates the address format for that coin, checks the balance, applies a minimum and a network-fee estimate, then reserves the amount and creates a payout request.
- **Important:** sending crypto out requires a hot-wallet private key. Storing a spending key in the app is a real theft risk, so by default withdrawals are queued and released by you with an admin-only `/payouts` command (approve / reject, reject refunds the balance). Say the word and I can add fully automatic signing instead, but that needs a wallet private key stored as a secret.
- The player gets a private confirmation with the request status and the transaction hash once paid.

## Technical notes

- New table `deposit_addresses` (coin, address, active) seeded from values you supply; new tables `deposits` (player, coin, tx hash unique, amount, confirmations, status, credited flag) and `withdrawals` (player, coin, address, amount cents, fee, status, tx hash, admin who released it). All with GRANTs and RLS restricted to service access; the bot writes through the server.
- `player_balances.balance` migrated to `balance_cents` (integer, euros x 100) with existing rows multiplied by 100; a `deposit_tag` column gives each player their unique matching suffix.
- Deposit scanning lives in a TanStack server route at `/api/public/discord/scan-deposits`, protected by a generated `CRON_SECRET`, called on a schedule. It reads confirmed transactions from public explorer APIs (Blockstream for BTC, Etherscan-style for ETH/USDT, TronGrid for TRC20) — free tiers, no custodial provider.
- Game logic goes in `src/lib/discord/games.ts` (mines/towers/upgrader as pure functions with defined house edge), commands in `commands.ts`, dispatch in the interactions route. Balance changes run through a single server-side debit/credit helper with a balance check, so a lost race can't create money.
- Ephemeral vs public is set per command via the interaction response flag.
- Slash commands must be re-synced from the app page after this ships.

## What I need from you
- The receiving wallet address for each coin you want to accept.
- Any explorer API key if you want higher rate limits (optional to start).
