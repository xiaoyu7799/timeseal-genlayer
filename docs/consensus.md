# TimeSeal consensus design

## What is being proven

Not "what time is it, to the second". The contract proves, at
date granularity (UTC), that a capsule's unlock date has arrived — and
that the proof came from independent validators, not from one clock.

## The nondet function

`unlock_capsule` runs `fetch_utc_date` under `gl.vm.run_nondet_unsafe`:

1. For each time source in order (timeapi.io, then
   worldtime.timezone.io), fetch the URL. A non-200 response, a network
   error, bad JSON, or a missing/unparseable date field means: try the
   next source.
2. The first source that answers 200 with a valid YYYY-MM-DD UTC date
   wins. The result is `{source, utc_date}` — strings only, never
   floats (GenVM calldata cannot encode floats).
3. If no source answers, the function raises
   `EXTERNAL: time_sources_unavailable` before any write. The capsule
   stays locked and the unlock can be retried later.

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
sources are down is itself consensus that nothing can be unlocked yet.

## The deterministic gate

After consensus, and only then, the contract checks
`agreed_utc_date >= unlock_date` (ISO dates compare lexicographically).
If the date has not arrived, it raises `EXPECTED: not_yet_unlock_date`
before any write. An early unlock attempt therefore fails cleanly, the
capsule stays locked, and the attempt can be retried after the date.
An unlocked capsule can never be re-locked or edited.

## Why two sources

worldtimeapi.org — the obvious free UTC API — sunset in 2026. A design
that depends on exactly one free API is one sunset away from being
unusable. Two independent sources, tried in order, with the actually
used source stored on the capsule, is the honest version of the same
idea. It does not make free APIs carry an SLA; it makes a single outage
non-fatal.

## What this does not prove

- Secrecy: capsules are public. The seal proves timing, not hiding.
- Sub-day precision: unlock granularity is one day (UTC).
- That the note is true: consensus proves the *date arrived*, not that
  a prediction is correct. Correctness is for the future to judge —
  that is the point of a sealed prediction.
