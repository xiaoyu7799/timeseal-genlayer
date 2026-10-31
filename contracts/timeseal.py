# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""TimeSeal: sealed commitments unlocked by GenLayer consensus on UTC time.

Problem
-------
"I predicted that before it happened" is easy to claim and impossible to
prove after the fact. A screenshot can be backdated, a post can be edited,
and a private note proves nothing about when it was written. The same
holds for a birthday message, a goal, or a milestone pledge: what matters
is not just what was said, but that it was said *before* a date.

What this contract does
-----------------------
1. Anyone seals a capsule: a title, a short note, a category, and an
   unlock date (YYYY-MM-DD, UTC). The capsule is a *public* commitment —
   the note itself is readable on-chain. What the seal proves is timing:
   the capsule existed on-chain before its unlock date, and it cannot be
   edited afterwards.
2. Anyone unlocks it once the date arrives. Validators independently
   fetch the current UTC date from public time sources and must agree
   on it before the capsule is marked unlocked. The leader's clock
   alone unlocks nothing.
3. Unlocking is date-granularity by design: a capsule unlocks on its
   unlock date (UTC), not at a precise second. That is what the
   consensus rule can honestly prove.

Consensus design (the part that matters)
----------------------------------------
* Time sources, tried in order, all free and keyless:
    - https://timeapi.io/api/time/current/zone?timeZone=UTC (field dateTime)
    - https://worldtime.timezone.io/api/timezone/Etc/UTC (field utc_datetime)
  The first source that answers 200 with a parseable UTC date wins, for
  the leader and for every validator independently. A single free time
  API can disappear (worldtimeapi.org itself sunset in 2026), so the
  fallback is part of the design, not an afterthought. The source that
  was actually used is stored on the capsule.
* A validator accepts the leader result only if:
    - the UTC date is a valid YYYY-MM-DD date,
    - the source is one of the two URLs above,
    - the validator's own independently fetched UTC date equals the
      leader's date, or equals the day *after* the leader's date (the
      midnight-crossing case: validators run just after the leader).
* After consensus, the unlock is still gated deterministically: the
  agreed UTC date must be >= the capsule's unlock date, otherwise the
  function raises before any write and the capsule stays locked. An
  early unlock attempt therefore fails cleanly and can be retried later.
* A failed fetch from every source raises a UserError before any write,
  so the capsule stays locked and retryable. An unlocked capsule can
  never be re-locked or edited.
* The nondet result carries only strings, never floats: GenVM calldata
  cannot encode floats (the lesson learned the hard way on WeatherProof).

Limits, stated honestly
-----------------------
* Capsules are public. Sealing proves *when* a commitment was made, not
  that it was hidden. Do not seal secrets here.
* Unlock granularity is one day (UTC). This contract cannot prove that
  something happened at a precise second.
* Free time APIs carry no SLA. The fallback chain mitigates a single
  outage, but if every listed source is down, unlocking waits — it does
  not fall back to an unvalidated clock.
* The seal request itself is deterministic and cannot check "is this
  date in the future", because a deterministic call has no trusted
  current time. The frontend blocks past unlock dates; sealing a past
  date at the contract level simply means the capsule is unlockable
  immediately, which is the caller's own choice.
"""

import json

from genlayer import *

TIME_SOURCES = (
    ("https://timeapi.io/api/time/current/zone?timeZone=UTC", "dateTime"),
    ("https://worldtime.timezone.io/api/timezone/Etc/UTC", "utc_datetime"),
)


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _next_date(date: str) -> str:
    year = int(date[0:4])
    month = int(date[5:7])
    day = int(date[8:10])
    days_in_month = [31, 29 if _is_leap(year) else 28, 31, 30, 31, 30,
                     31, 31, 30, 31, 30, 31][month - 1]
    day += 1
    if day > days_in_month:
        day = 1
        month += 1
        if month > 12:
            month = 1
            year += 1
    return f"{year:04d}-{month:02d}-{day:02d}"


class TimeSeal(gl.Contract):
    capsules: TreeMap[u256, str]
    ids: DynArray[u256]
    next_id: u256

    def __init__(self):
        self.next_id = u256(0)

    # -- deterministic helpers -------------------------------------------

    def _load(self, capsule_id: u256) -> dict:
        if capsule_id not in self.capsules:
            raise gl.vm.UserError("EXPECTED: capsule_not_found")
        return json.loads(self.capsules[capsule_id])

    def _check_date(self, date: str) -> None:
        if len(date) != 10 or date[4] != "-" or date[7] != "-":
            raise gl.vm.UserError("EXPECTED: date_must_be_YYYY-MM-DD")
        year = date[0:4]
        month = date[5:7]
        day = date[8:10]
        for part in (year, month, day):
            for ch in part:
                if ch < "0" or ch > "9":
                    raise gl.vm.UserError("EXPECTED: date_must_be_YYYY-MM-DD")
        if int(year) < 1940 or int(year) > 2100:
            raise gl.vm.UserError("EXPECTED: date_out_of_range")
        if int(month) < 1 or int(month) > 12:
            raise gl.vm.UserError("EXPECTED: date_out_of_range")
        if int(day) < 1 or int(day) > 31:
            raise gl.vm.UserError("EXPECTED: date_out_of_range")

    def _check_text(self, text: str, low: int, high: int, name: str) -> str:
        value = text.strip()
        if len(value) < low or len(value) > high:
            raise gl.vm.UserError(f"EXPECTED: {name}_length")
        return value

    # -- writes ------------------------------------------------------------

    @gl.public.write
    def seal_capsule(
        self,
        title: str,
        note: str,
        category: str,
        unlock_date: str,
    ) -> u256:
        title = self._check_text(title, 2, 80, "title")
        note = self._check_text(note, 2, 500, "note")
        category = self._check_text(category, 2, 40, "category")
        unlock_date = unlock_date.strip()
        self._check_date(unlock_date)
        capsule_id = self.next_id
        self.next_id = capsule_id + u256(1)
        record = {
            "id": int(capsule_id),
            "title": title,
            "note": note,
            "category": category,
            "unlock_date": unlock_date,
            "requester": str(gl.message.sender_address),
            "status": "locked",
            "unlocked_date": None,
            "unlock_source": None,
        }
        self.capsules[capsule_id] = json.dumps(record)
        self.ids.append(capsule_id)
        return capsule_id

    @gl.public.write
    def unlock_capsule(self, capsule_id: u256) -> str:
        record = self._load(capsule_id)
        if record["status"] != "locked":
            raise gl.vm.UserError("EXPECTED: capsule_already_unlocked")
        unlock_date = record["unlock_date"]

        def fetch_utc_date() -> dict:
            for url, field in TIME_SOURCES:
                try:
                    response = gl.nondet.web.get(url)
                except Exception:
                    continue
                if getattr(response, "status", 200) != 200:
                    continue
                body = response.body
                if isinstance(body, bytes):
                    text = body.decode("utf-8")
                else:
                    text = str(body)
                try:
                    data = json.loads(text)
                except Exception:
                    continue
                value = data.get(field) if isinstance(data, dict) else None
                if not isinstance(value, str) or len(value) < 10:
                    continue
                utc_date = value[0:10]
                try:
                    self._check_date(utc_date)
                except Exception:
                    continue
                return {"source": url, "utc_date": utc_date}
            raise gl.vm.UserError("EXTERNAL: time_sources_unavailable")

        def validate(leader_result) -> bool:
            if isinstance(leader_result, gl.vm.UserError):
                try:
                    fetch_utc_date()
                except gl.vm.UserError:
                    return True
                except Exception:
                    return False
                return False
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader = leader_result.calldata
            if not isinstance(leader, dict):
                return False
            source = leader.get("source")
            leader_date = leader.get("utc_date")
            if not isinstance(source, str) or not isinstance(leader_date, str):
                return False
            if source not in [url for url, _ in TIME_SOURCES]:
                return False
            try:
                self._check_date(leader_date)
                own = fetch_utc_date()
            except Exception:
                return False
            own_date = own["utc_date"]
            # Validators run just after the leader, so their date is the
            # leader's date, or the next day across a UTC midnight.
            if own_date != leader_date and own_date != _next_date(leader_date):
                return False
            return True

        result = gl.vm.run_nondet_unsafe(fetch_utc_date, validate)
        # Deterministic gate, applied after consensus: the agreed UTC
        # date must have reached the unlock date, or nothing is written.
        if result["utc_date"] < unlock_date:
            raise gl.vm.UserError("EXPECTED: not_yet_unlock_date")
        record["status"] = "unlocked"
        record["unlocked_date"] = result["utc_date"]
        record["unlock_source"] = result["source"]
        self.capsules[capsule_id] = json.dumps(record)
        return json.dumps(record)

    # -- views -------------------------------------------------------------

    @gl.public.view
    def get_capsule(self, capsule_id: u256) -> str:
        return json.dumps(self._load(capsule_id))

    @gl.public.view
    def get_count(self) -> u256:
        return u256(len(self.ids))

    @gl.public.view
    def list_capsules(self, offset: u256, limit: u256) -> str:
        if limit < 1 or limit > 20:
            raise gl.vm.UserError("EXPECTED: limit_must_be_1_to_20")
        total = len(self.ids)
        start = int(offset)
        if start >= total:
            return json.dumps([])
        end = start + int(limit)
        if end > total:
            end = total
        out = []
        index = start
        while index < end:
            out.append(json.loads(self.capsules[self.ids[index]]))
            index += 1
        return json.dumps(out)
