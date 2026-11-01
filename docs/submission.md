# TimeSeal v2 — Projects resubmission copy (edit of the existing submission, NOT a new submission)

Title: TimeSeal — Hidden predictions, revealed by consensus

## One-liner

Seal a prediction while it is still secret — only its SHA-256 commitment goes on-chain. GenLayer consensus verifies the date and the hash before the prediction is ever revealed.

## Short description

TimeSeal v2 answers the review directly: v1 stored notes in plaintext and only toggled a status flag, so nothing was actually sealed. In v2, sealing sends only a SHA-256 commitment — SHA-256(salt + newline + prediction) — computed in the browser; the prediction and its reveal key never leave the browser at seal time. A sealed capsule shows its public question, the truncated commitment and a live countdown, and nothing else. After the reveal date, anyone reveals it with the prediction and key: GenLayer validators independently fetch the current UTC date from public time sources and must agree it has arrived, then the contract itself recomputes the hash with a pure-Python SHA-256 implementation and compares it with the stored commitment. Only an exact match publishes the prediction, with the revealed date and source recorded; a wrong prediction or key fails before any write. It is free on gasless Stable Studionet, needs no server and no API key.

## Expected result

1. Seal a capsule: question, secret prediction, reveal key, future date — only the commitment hash goes on-chain. 2. The vault shows it sealed with a countdown and no prediction text. 3. After the date, reveal with the exact prediction and key; validators confirm the UTC date and the contract verifies the hash, then the prediction appears with its revealed date and source. 4. A wrong prediction or key leaves the capsule sealed. 5. All transactions reach FINALIZED on Stable Studionet.

## What it does

- Commit: public question, secret prediction, reveal key, category, future reveal date (UTC). Only the SHA-256 commitment goes on-chain.
- Wait with a live countdown ticking down to the reveal date.
- Reveal on-chain: validators independently fetch the UTC date and compare it with the reveal date; the contract recomputes SHA-256 and compares it with the commitment; only an exact match publishes the prediction.
- Browse sealed and revealed capsules, with category, countdown, reveal date, revealed prediction and source.
- Browser-only local check (clearly labelled, not on-chain) recomputes the hash and compares it with the on-chain commitment.
- Browser UTC check (clearly labelled, not on-chain) shows what GenLayer will check.
- Experience: four languages (English, 中文, 日本語, 한국어), a user-toggled ambient time pad with a FINALIZED chime, an opening seal-stamp splash, scroll-reveal motion, a canvas river of drifting time-motes, a scrolling ticker, and mouse effects (cursor glow, parallax, tilt) on desktop — with reduced-motion and touch fallbacks.
- Wallet compatibility, not MetaMask-only: any injected wallet connects and reads; wallets without Snap support get a clearly labelled ephemeral in-browser reviewer test account (key never leaves the browser, real on-chain transaction, requester shown honestly).

## How GenLayer is used (not decorative)

The contract itself fetches the web and itself checks the hash. The leader's clock alone reveals nothing: every validator independently fetches the current UTC date from a public time source and only accepts the result if its own date is the same day, or the next day across a UTC midnight. Then two deterministic gates run before any write: the agreed date must have reached the reveal date, and the contract's own pure-Python SHA-256 of the supplied prediction and salt must equal the stored commitment. If either gate fails, nothing is written. The core result — publishing a previously hidden prediction — is produced by GenLayer consensus, not by the frontend, not by one server, and not by an LLM (there is none in this path, deliberately).

## Main tag

Other

## Sub-tags

Data Verification, Research Reproducibility

## Links (proof materials, links only)

- Website: https://xiaoyu7799.github.io/timeseal-genlayer/
- GitHub: https://github.com/xiaoyu7799/timeseal-genlayer
- Contract (v2): https://explorer-studio.genlayer.com/address/0x0405c80c657615aBa8b7F8174bdc981Bd55e0491
- Deploy tx (v2): 0xfc3d16278d73377018aaa103c200bd7b51678ad9a3b0351f73f04d989f3968d3
- Seal tx (capsule #0): 0xf2b2ae37dfef87bdaeed2270ce81dec7740dba52db952bdb211efe2478316134
- Reveal tx (capsule #0): 0xb8dbd9e98aa57d4fb3b49eaf02849d0c705adc5272bd2fa830bbf5d06beb8716
- Demo seal tx (capsule #1, unlock date 2026-11-02): 0x6ec0d866732a18767a431260b13d6a4f9ead2645554eaba2e39239784b441517
- Verified capsule #0: question "Will the TimeSeal v2 reveal flow verify its own commitment on-chain?", sealed record contains commitment + question only (no plaintext), revealed with prediction, revealed date 2026-11-01, source timeapi.io
- Evidence: https://github.com/xiaoyu7799/timeseal-genlayer/blob/main/evidence.json

## Note on v1 (do NOT cite v1 as proof)

v1's contract (0xcc4E4bd6ac4f3D6ccec724E9B3EBD73E6Eb4E204) and its public capsules remain on-chain but are superseded for submission purposes: they stored plaintext and only toggled a status flag. The qualifying version is v2 only, at the address above. The mismatch (wrong-secret) case is proven by local simulation only, labelled as such in evidence.json — no doomed on-chain transaction was sent.
