# TimeSeal — Projects submission copy

Title: TimeSeal — Sealed predictions, unlocked by time

## One-liner

Seal a prediction or message on-chain, then let GenLayer validators independently confirm the UTC date has arrived before it unlocks. No backdating, no edited screenshots.

## Short description

TimeSeal solves a simple trust problem: "I predicted that before it happened" is easy to claim and impossible to prove afterwards. On the website, the user seals a capsule — a title, a note, a category and a future unlock date. The Intelligent Contract stores it uneditably. When the date arrives, anyone can unlock it: validators independently fetch the current UTC date from public time sources and must agree it has arrived, and only then is the capsule marked unlocked with the date and source recorded. A locked capsule shows a live countdown; an unlocked one is a public, shareable proof that the commitment existed before its date. It is free on gasless Stable Studionet, needs no server and no API key.

## What it does

- Seal a capsule: title, note, category, future unlock date (UTC).
- Wait with a live countdown ticking down to the unlock date.
- Unlock it on-chain: validators independently fetch the UTC date and compare it with the unlock date.
- Browse locked and unlocked capsules, with category, countdown, unlock date and unlock source.
- Browser UTC check (clearly labelled, not on-chain) shows what GenLayer will check.
- Experience: four languages (English, 中文, 日本語, 한국어), a user-toggled ambient time pad with a FINALIZED chime, an opening seal-stamp splash, scroll-reveal motion, a canvas river of drifting time-motes, a scrolling ticker, and mouse effects (cursor glow, parallax, tilt) on desktop — with reduced-motion and touch fallbacks.

## How GenLayer is used (not decorative)

The contract itself fetches the web. The leader's clock alone unlocks nothing: every validator independently fetches the current UTC date from a public time source and only accepts the result if its own date is the same day, or the next day across a UTC midnight. Then a deterministic gate checks the agreed date against the unlock date — if the date has not arrived, nothing is written and the capsule stays locked. The core result is produced by GenLayer consensus, not by the frontend, not by one server, and not by an LLM (there is none in this path, deliberately).

## Main tag

Other

## Links

- Website: https://xiaoyu7799.github.io/timeseal-genlayer/
- GitHub: https://github.com/xiaoyu7799/timeseal-genlayer
- Contract: https://explorer-studio.genlayer.com/address/0xcc4E4bd6ac4f3D6ccec724E9B3EBD73E6Eb4E204
- Deploy tx: 0x983fc2159502ce26b36b9af49cde4c02f90944889324dbbeac486ffb3b8e9720
- Seal tx (capsule #0): 0xe5ca1ed0532945f64398818d46b58d4fe2af71e46497614f1c9bc90ee18c97bd
- Unlock tx (capsule #0): 0x0c38561998aa9a2e972c61f24422f3d7fed2d81d7be32b7d87d5005da14e8577
- Verified capsule #0: "TimeSeal genesis capsule", unlock date 2026-10-31, unlocked date 2026-10-31, unlock source timeapi.io
- Logo: assets/logo.svg (PNG: assets/logo.png)
