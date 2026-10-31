# TimeSeal — “I said it before it happened.”

**Live site:** https://xiaoyu7799.github.io/timeseal-genlayer/
**Contract:** https://explorer-studio.genlayer.com/address/0xcc4E4bd6ac4f3D6ccec724E9B3EBD73E6Eb4E204
**Repo:** https://github.com/xiaoyu7799/timeseal-genlayer

Seal a prediction, a birthday message, a goal — anything you want proven
to exist before a date. GenLayer validators independently check the
current UTC date and only unlock the capsule once that date has arrived.
No backdating, no edited screenshots, no "trust me".

## The problem

"I predicted that before it happened" is easy to claim and impossible to
prove after the fact. A screenshot can be backdated, a post can be edited,
and a private note proves nothing about when it was written. The same
holds for a birthday message, a goal, or a milestone pledge: what matters
is not just what was said, but that it was said *before* a date.

## What it does

- **Seal a capsule:** title, note, category (Prediction, Birthday message,
  Goal, Milestone, Sports, Other) and an unlock date (YYYY-MM-DD, UTC).
  The capsule is written on-chain exactly as given and cannot be edited.
- **Wait:** a live countdown ticks down to the unlock date, second by
  second, on a flowing river of capsules.
- **Unlock on-chain:** validators fetch the current UTC date from public
  time sources and must agree it has arrived before the capsule is marked
  unlocked, together with the date and the source that was used.
- **Browse the vault:** every capsule, locked and unlocked, with its
  category, countdown, unlock date and unlock source.

**Capsules are public commitments.** Sealing proves *when* something was
said — it does not hide it. Never seal a secret here.

## How GenLayer is used (not decorative)

The contract itself fetches the web. The leader's clock alone unlocks
nothing: every validator independently fetches the current UTC date from
a public time source and only accepts the result if its own date is the
same day, or the next day across a UTC midnight. Then a deterministic gate
checks the agreed date against the unlock date — if the date has not
arrived, nothing is written and the capsule stays locked. The core result
(the unlock) is produced by GenLayer consensus, not by the frontend, not
by one server, and not by an LLM (there is none in this path, deliberately).

Time sources, tried in order, all free and keyless:

- https://timeapi.io/api/time/current/zone?timeZone=UTC (`dateTime`)
- https://worldtime.timezone.io/api/timezone/Etc/UTC (`utc_datetime`)

The fallback is part of the design: worldtimeapi.org itself sunset in
2026, so a single free time API is not a safe dependency. If every listed
source is down, unlocking waits — it does not fall back to an unvalidated
clock. Full consensus rules and honest limits are in
[`docs/consensus.md`](docs/consensus.md).

## Contract

- **Network:** Stable Studionet only — chain ID 61999,
  RPC https://studio.genlayer.com/api. Gasless, zero cost, no real funds.
- **Address:** `0xcc4E4bd6ac4f3D6ccec724E9B3EBD73E6Eb4E204`
- **Deploy tx:** `0x983fc2159502ce26b36b9af49cde4c02f90944889324dbbeac486ffb3b8e9720` (FINALIZED)
- **File:** [`contracts/timeseal.py`](contracts/timeseal.py)
- **Writes:** `seal_capsule(title, note, category, unlock_date) -> u256`,
  `unlock_capsule(id) -> str`
- **Views:** `get_capsule(id)`, `get_count()`, `list_capsules(offset, limit 1–20)`
- **Storage:** `capsules: TreeMap[u256, str]` (JSON records),
  `ids: DynArray[u256]`, `next_id: u256`
- **Verified flow (see [`evidence.json`](evidence.json)):** capsule #0,
  "TimeSeal genesis capsule", sealed by tx
  `0xe5ca1ed0532945f64398818d46b58d4fe2af71e46497614f1c9bc90ee18c97bd`
  (FINALIZED), unlocked by tx
  `0x0c38561998aa9a2e972c61f24422f3d7fed2d81d7be32b7d87d5005da14e8577`
  (FINALIZED), read back unlocked with `unlocked_date: 2026-10-31` and
  `unlock_source: https://timeapi.io/api/time/current/zone?timeZone=UTC`.
  A second capsule (#1, "First public prediction", unlock date 2026-11-01)
  was also sealed on-chain (tx
  `0xa7374ec8938d2eac55165799312147a8d6c9088b642814c85905ca476314ee81`)
  so the live vault shows a locked capsule counting down.

## Frontend

The site is a flowing river of time, not a static form — its own visual
language, built for this project (dark midnight + gold seal + violet
aurora, Sora display type):

- **Nothing stands still:** a canvas river of drifting time-motes, an
  animated aurora background, a scrolling ticker, a live UTC clock
  ticking every second, countdowns ticking on every locked capsule, a
  flowing timeline line, and gradient text that keeps moving.
- **Experience:** four languages (English, 中文, 日本語, 한국어)
  switchable in the header and remembered; an ambient time pad generated
  with the Web Audio API, off by default and only started by the user's
  toggle, with a soft chime when a transaction reaches FINALIZED; an
  opening seal-stamp splash once per session (click anywhere to skip);
  scroll-reveal pop for content below the fold; and mouse playfulness on
  fine pointers — cursor glow, hero parallax, card tilt, magnetic
  buttons — all disabled for touch devices and reduced-motion users.
- **Wallet compatibility — not MetaMask-only.** Any injected EVM wallet
  (MetaMask, OKX, Rabby, Coinbase, …) can connect and read. If a wallet
  cannot install the GenLayer Snap (e.g. OKX, which has no
  `wallet_getSnaps`), the app does not block the reviewer: it offers a
  clearly labelled **reviewer test account** — an ephemeral account
  generated in the browser, on gasless Studionet only, whose key never
  leaves the browser and is discarded on refresh. Transactions signed
  this way are real on-chain transactions, but the requester shown
  on-chain is the test account, not the reviewer's wallet address, and
  the UI says so. It never presents a test-account transaction as
  wallet-signed, and it never fakes a result. Reading existing capsules
  still works without any wallet.
- **Browser preview (clearly labelled, not on-chain):** the "Check the
  UTC time" button fetches the same public time sources from the browser
  so you can see what GenLayer will check. If both sources are down, it
  falls back to the browser clock and says so — the contract never uses
  that fallback.

### Run it locally

```bash
cd frontend
npm install
VITE_CONTRACT_ADDRESS=0xcc4E4bd6ac4f3D6ccec724E9B3EBD73E6Eb4E204 npm run dev
```

### Deploy / flow scripts

```bash
npm install
node scripts/deploy.mjs   # writes deployment.json (key never written to disk)
node scripts/flow.mjs     # seals + unlocks a capsule, writes evidence.json
```

Both scripts accept `GENLAYER_PRIVATE_KEY` (ephemeral key generated if
omitted; Studionet is gasless and the contract is permissionless, so
losing that key loses nothing).

## Repository layout

- `contracts/timeseal.py` — the Intelligent Contract
- `frontend/` — Vite + React site (base `./`, built by the Pages workflow)
- `scripts/deploy.mjs`, `scripts/flow.mjs` — deploy + verified flow
- `docs/` — consensus design and submission copy
- `assets/logo.svg`, `assets/logo.png` — project logo
- `deployment.json`, `evidence.json` — on-chain proof (no keys inside)

## Tests / checks done

- Contract compiles (`py_compile`) and deploys to Stable Studionet.
- Seal → unlock flow reaches FINALIZED for both transactions and reads
  back unlocked (see `evidence.json`).
- A second capsule with a future unlock date is sealed and stays locked,
  so the vault demonstrates both states and a live countdown.
- Frontend builds (`vite build`) and the live Pages bundle contains the
  contract address and the reviewer-test-account fallback.
- i18n key check: zero missing keys across English, 中文, 日本語, 한국어.

## Honest limits

- Capsules are public; this proves timing, not secrecy.
- Unlock granularity is one day (UTC), not a precise second.
- Free time APIs have no SLA; the two-source fallback mitigates, but
  cannot eliminate, a total outage — unlocking then waits.
- The browser-wallet write path on the live site has not been personally
  tested with a real wallet (no wallet available to the builder); the
  same write calls were proven end-to-end via script to FINALIZED with
  verified read-back.
