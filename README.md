# TimeSeal — “I said it before it happened.”

**Live site:** https://xiaoyu7799.github.io/timeseal-genlayer/
**Contract (v2):** https://explorer-studio.genlayer.com/address/0x0405c80c657615aBa8b7F8174bdc981Bd55e0491
**Repo:** https://github.com/xiaoyu7799/timeseal-genlayer

Seal a prediction while it is still secret: only its SHA-256 commitment
goes on-chain. When the reveal date arrives, GenLayer validators
independently confirm the UTC date, the contract itself re-checks the
hash, and only then is the prediction revealed. No backdating, no edited
screenshots, no "trust me" — and nothing to read before the reveal,
because the prediction was never on-chain in the first place.

## The problem

"I predicted that before it happened" is easy to claim and impossible to
prove after the fact. A screenshot can be backdated, a post can be edited,
and a private note proves nothing about when it was written. The same
holds for a birthday message, a goal, or a milestone pledge: what matters
is not just what was said, but that it was said *before* a date.

## What it does (v2 commit-reveal)

- **Commit:** a public question, a secret prediction, a category
  (Prediction, Birthday message, Goal, Milestone, Sports, Other) and a
  reveal date (YYYY-MM-DD, UTC). The browser generates a 16-character
  reveal key, computes `SHA-256(salt + "\n" + prediction)` locally, and
  sends **only the question, the commitment hash, the category and the
  reveal date** on-chain. The prediction and the salt never leave the
  browser at seal time.
- **Wait:** a live countdown ticks down to the reveal date, second by
  second, on a flowing river of capsules. A sealed card shows the
  question, the truncated commitment and the countdown — never the
  prediction, because the chain does not have it.
- **Reveal on-chain:** anyone supplies the prediction and the reveal
  key. Validators fetch the current UTC date from public time sources
  and must agree it has arrived; then the contract itself recomputes
  the SHA-256 hash and compares it with the stored commitment. Only on
  an exact match is the prediction written to the record, together with
  the revealed date and the source used. A wrong prediction or key
  fails before any write, and the capsule stays sealed.
- **Browse the vault:** every capsule, sealed and revealed, with its
  category, countdown, reveal date, revealed prediction and source.
  Each sealed card also offers a browser-only local check that
  recomputes the hash and compares it with the on-chain commitment —
  explicitly labelled as not on-chain proof.

**Why v2 exists.** v1 stored the note in plaintext and its unlock call
only flipped a date-based status flag. A reviewer rightly rejected that
submission: the claimed sealed-prediction workflow was not implemented,
because there was nothing sealed. v1's contract and its public capsules
remain on-chain, but they are **not** part of this version and must not
be cited as proof of a sealed workflow. v2 is a new contract; its
records carry no plaintext at seal time.

## How GenLayer is used (not decorative)

The contract itself fetches the web and itself checks the hash. The
leader's clock alone reveals nothing: every validator independently
fetches the current UTC date from a public time source and only accepts
the result if its own date is the same day, or the next day across a UTC
midnight. Then two deterministic gates run before any write: the agreed
date must have reached the reveal date, and the contract's own pure-Python
SHA-256 of the supplied prediction and salt must equal the stored
commitment. If either gate fails, nothing is written and the capsule
stays sealed. The core result (the reveal) is produced by GenLayer
consensus, not by the frontend, not by one server, and not by an LLM
(there is none in this path, deliberately). The SHA-256 implementation
uses no imports at all — GenVM stdlib availability is unproven — and was
verified against hashlib before deployment.

Time sources, tried in order, all free and keyless:

- https://timeapi.io/api/time/current/zone?timeZone=UTC (`dateTime`)
- https://worldtime.timezone.io/api/timezone/Etc/UTC (`utc_datetime`)

The fallback is part of the design: worldtimeapi.org itself sunset in
2026, so a single free time API is not a safe dependency. If every listed
source is down, revealing waits — it does not fall back to an unvalidated
clock. Full consensus rules and honest limits are in
[`docs/consensus.md`](docs/consensus.md).

## Contract

- **Network:** Stable Studionet only — chain ID 61999,
  RPC https://studio.genlayer.com/api. Gasless, zero cost, no real funds.
- **Address (v2):** `0x0405c80c657615aBa8b7F8174bdc981Bd55e0491`
- **Deploy tx:** `0xfc3d16278d73377018aaa103c200bd7b51678ad9a3b0351f73f04d989f3968d3` (FINALIZED)
- **File:** [`contracts/timeseal.py`](contracts/timeseal.py)
- **Writes:** `seal_capsule(question, commitment, category, unlock_date) -> u256`,
  `reveal_capsule(id, prediction, salt) -> str`
- **Views:** `get_capsule(id)`, `get_count()`, `list_capsules(offset, limit 1–20)`
- **Storage:** `capsules: TreeMap[u256, str]` (JSON records),
  `ids: DynArray[u256]`, `next_id: u256`
- **Verified flow (see [`evidence.json`](evidence.json)):** capsule #0,
  "Will the TimeSeal v2 reveal flow verify its own commitment on-chain?",
  sealed by tx
  `0xf2b2ae37dfef87bdaeed2270ce81dec7740dba52db952bdb211efe2478316134`
  (FINALIZED) — the sealed record was read back and contains the
  commitment and the question **only**; the prediction plaintext appears
  nowhere in it. Revealed by tx
  `0xb8dbd9e98aa57d4fb3b49eaf02849d0c705adc5272bd2fa830bbf5d06beb8716`
  (FINALIZED), read back revealed with
  `revealed_prediction: "Yes — the reveal will verify, and the revealed record will carry the date and source."`,
  `revealed_date: 2026-11-01` and
  `source: https://timeapi.io/api/time/current/zone?timeZone=UTC`.
  A second capsule (#1, unlock date 2026-11-02) was also sealed on-chain
  (tx `0x6ec0d866732a18767a431260b13d6a4f9ead2645554eaba2e39239784b441517`,
  FINALIZED) so the live vault shows a sealed capsule counting down.
  The wrong-secret case is proven by local simulation only (see
  [`docs/consensus.md`](docs/consensus.md)) — no doomed on-chain
  transaction was sent.

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
  that fallback. Likewise, each sealed card's "check my reveal key
  locally" control recomputes the hash in the browser and compares it
  with the on-chain commitment; it is labelled browser-only, and only a
  successful on-chain reveal publishes the prediction.
- **Commit form honesty:** the seal panel shows the computed commitment
  before submit and states plainly that only the hash goes on-chain.
  The prediction field is password-style with show/hide, the reveal key
  is auto-generated (16 characters, `crypto.getRandomValues`) with a
  copy button, and every language warns that losing the key means the
  capsule can never be revealed.

### Run it locally

```bash
cd frontend
npm install
VITE_CONTRACT_ADDRESS=0x0405c80c657615aBa8b7F8174bdc981Bd55e0491 npm run dev
```

### Deploy / flow scripts

```bash
npm install
node scripts/deploy.mjs   # writes deployment.json (key never written to disk)
node scripts/flow.mjs     # seals + reveals capsule #0, seals demo #1, writes evidence.json
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
- The in-contract pure-Python SHA-256 matches hashlib exactly on
  vectors including `""`, `"abc"`, a 1000-character string, padding
  boundaries (55/56/64 chars), unicode samples, and salt + newline +
  prediction samples; matching inputs reproduce the commitment and
  mismatching inputs do not (local simulation, labelled as such).
- Seal → reveal flow reaches FINALIZED for both transactions and reads
  back revealed (see `evidence.json`); the sealed read-back was
  asserted to contain no prediction plaintext.
- A second capsule with a future reveal date is sealed and stays
  sealed, so the vault demonstrates both states and a live countdown.
- Frontend builds (`vite build`) and the live Pages bundle contains the
  v2 contract address and the reveal strings.
- i18n key check: zero missing keys across English, 中文, 日本語, 한국어
  (97 keys each, script-checked).

## Honest limits

- A hash hides but does not encrypt: a short, guessable prediction can
  be brute-forced from the commitment. Seal predictions with real content.
- Losing the reveal key, or forgetting the exact prediction, means the
  capsule can never be revealed. There is no recovery.
- Reveal granularity is one day (UTC), not a precise second.
- Free time APIs have no SLA; the two-source fallback mitigates, but
  cannot eliminate, a total outage — revealing then waits.
- The browser-wallet write path on the live site has not been personally
  tested with a real wallet (no wallet available to the builder); the
  same write calls were proven end-to-end via script to FINALIZED with
  verified read-back. The wrong-secret on-chain case was deliberately
  not sent; it is proven by local simulation only.
