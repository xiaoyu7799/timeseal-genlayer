# TimeSeal v2 consensus design

## What is being proven

Two things, both gated by GenLayer consensus:

1. That a capsule's reveal date has arrived, at date granularity (UTC),
   proven by independent validators — not by one clock.
2. That the prediction revealed now is the prediction committed to at
   seal time — proven by the contract itself recomputing SHA-256 and
   comparing it with the stored commitment. A wrong prediction or a
   wrong salt publishes nothing.

The second point is the whole reason v2 exists. v1 stored the note in
plaintext and its unlock call only flipped a date-based status flag; a
reviewer rejected that submission because the claimed sealed-prediction
workflow was not implemented — there was nothing sealed. v2's records
carry no plaintext at seal time, and the reveal is a new write whose
content is produced only by a successful consensus-gated hash check.

## The commit (deterministic, no consensus needed)

`seal_capsule(question, commitment, category, unlock_date)`:

- The question is public (2–120 chars), the category is public
  (2–40 chars), the reveal date is validated as YYYY-MM-DD.
- The commitment must be exactly 64 lowercase hex characters, checked
  in-contract, character by character.
- The prediction plaintext is never an argument and never stored. The
  browser computes `SHA-256(salt + "\n" + prediction)` with WebCrypto
  and sends only the hash. Anyone reading the chain sees a question and
  a hash — not a prediction.

The seal call is deterministic, so it cannot check "is this date in the
future" (a deterministic call has no trusted current time). The
frontend blocks past reveal dates; sealing a past date at the contract
level simply means the capsule is revealable immediately.

## The nondet function

`reveal_capsule` runs `fetch_utc_date` under `gl.vm.run_nondet_unsafe`:

1. For each time source in order (timeapi.io, then
   worldtime.timezone.io), fetch the URL. A non-200 response, a network
   error, bad JSON, or a missing/unparseable date field means: try the
   next source.
2. The first source that answers 200 with a valid YYYY-MM-DD UTC date
   wins. The result is `{source, utc_date}` — strings only, never
   floats (GenVM calldata cannot encode floats).
3. If no source answers, the function raises
   `EXTERNAL: time_sources_unavailable` before any write. The capsule
   stays sealed and the reveal can be retried later.

## The validator

A validator accepts the leader result only if:

- the source is one of the two listed URLs,
- the UTC date is a valid YYYY-MM-DD date,
- the validator's own independently fetched UTC date equals the
  leader's date, or equals the day *after* the leader's date (the
  midnight-crossing case, computed with leap-year-aware date arithmetic
  in `_next_date`).

It never accepts a date it did not independently reproduce. If the
leader raised a UserError, the validator re-fetches: agreement that the
sources are down is itself consensus that nothing can be revealed yet.

## The deterministic gates

After consensus, and only then, two gates run before any write:

1. **Date gate:** `agreed_utc_date >= unlock_date` (ISO dates compare
   lexicographically). If the date has not arrived, the function raises
   `EXPECTED: not_yet_unlock_date` before any write. An early reveal
   attempt fails cleanly, the capsule stays sealed, and the attempt can
   be retried after the date.
2. **Hash gate:** the contract recomputes
   `SHA-256(salt + "\n" + prediction)` with its own pure-Python
   implementation and compares it with the stored commitment. On a
   mismatch it raises `EXPECTED: commitment_mismatch` before any write.
   The capsule stays sealed and retryable. A revealed capsule can never
   be re-sealed or edited.

The prediction is hashed exactly as supplied — no stripping, no
normalisation — because the reveal must reproduce the seal-time hash bit
for bit. The frontend therefore sends the prediction exactly as typed,
and the reveal form warns that it must match exactly.

## SHA-256 without imports

GenVM's stdlib availability is unproven, so the contract implements
SHA-256 from the FIPS 180-4 constants with no imports at all (only
integer arithmetic, lists and string indexing; UTF-8 encoding is done by
hand from code points). Before deployment, the exact code shipped in the
contract was extracted and tested against hashlib on: `""`, `"abc"`, a
1000-character string, padding boundaries (55, 56 and 64 characters),
unicode samples, and salt + newline + prediction samples. Every vector
matched exactly, matching inputs reproduce a commitment, and mismatching
inputs (wrong prediction, wrong salt) do not.

## The mismatch case: simulation, not an on-chain transaction

A wrong-secret reveal was deliberately NOT sent on-chain. It would prove
nothing extra: the hash function is already verified against hashlib,
and the contract code path raises before any write on mismatch. The
mismatch proof in this repo is therefore labelled **simulation only**
in `evidence.json`, and it must never be presented as on-chain
evidence. The on-chain evidence is the successful seal → reveal flow
plus the sealed read-back asserting that no plaintext is present.

## Why two sources

worldtimeapi.org — the obvious free UTC API — sunset in 2026. A design
that depends on exactly one free API is one sunset away from being
unusable. Two independent sources, tried in order, with the actually
used source stored on the capsule, is the honest version of the same
idea. It does not make free APIs carry an SLA; it makes a single outage
non-fatal.

## What this does not prove

- Encryption: a hash hides, it does not encrypt. A short, guessable
  prediction can be brute-forced from the commitment. Seal predictions
  with real content.
- Recovery: losing the reveal key, or forgetting the exact prediction,
  means the capsule can never be revealed. The contract never saw the
  plaintext, so it cannot reconstruct it.
- Sub-day precision: reveal granularity is one day (UTC).
- That the prediction is true: consensus proves the *date arrived* and
  the *prediction matches the commitment*, not that a prediction is
  correct. Correctness is for the future to judge — that is the point
  of a sealed prediction.

## v1 migration note

v1's contract and its public capsules remain on-chain, but they are not
part of the qualifying version: they contain plaintext notes and their
unlock only toggled a status flag. They must not be cited as proof of a
sealed workflow. v2 is a separate contract with a separate address;
nothing was migrated, because there is nothing to migrate — a plaintext
capsule cannot become a hidden commitment after the fact.
