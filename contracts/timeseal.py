# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""TimeSeal v2: hidden commitments, revealed by GenLayer consensus.

Problem
-------
"I predicted that before it happened" is easy to claim and impossible to
prove after the fact. A screenshot can be backdated, a post can be edited,
and a private note proves nothing about when it was written.

What this contract does (commit-reveal)
----------------------------------------
1. Anyone seals a capsule: a *public* question, a *secret* prediction,
   a category, and an unlock date (YYYY-MM-DD, UTC). At seal time only
   the SHA-256 commitment ``SHA-256(salt + "\\n" + prediction)`` goes
   on-chain. The prediction plaintext is never an argument to the seal
   call and is never stored. Until reveal, nobody — not the sealer's
   audience, not a reader of the chain — can see what was predicted.
2. After the unlock date arrives, anyone reveals the capsule by
   supplying the prediction and the salt. Validators independently fetch
   the current UTC date from public time sources and must agree it has
   arrived; then the contract itself recomputes the SHA-256 hash and
   compares it to the stored commitment. Only on an exact match is the
   prediction written to the record, together with the revealed date and
   the time source used. A wrong prediction or a wrong salt fails
   before any write, and the capsule stays sealed and retryable.
3. The GenLayer result therefore has a meaningful consequence: it is
   the gate that either publishes a previously hidden prediction or
   publishes nothing at all. This is not a status toggle on public
   content — the content itself is only produced by a successful
   consensus-gated reveal.

Why v1 was rejected, and what changed
--------------------------------------
v1 stored the note in plaintext at seal time and its unlock call only
flipped a date-based status flag. A reviewer rightly rejected that:
the claimed sealed-prediction workflow was not implemented, because
there was nothing sealed. v1's contract and its public capsules remain
on-chain, but they are NOT part of this version and must not be cited
as proof of a sealed workflow. v2 is a new contract; its records carry
no plaintext at seal time, and reveal is a new, separate write.

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
* After consensus, two deterministic gates run before any write:
    - the agreed UTC date must be >= the capsule's unlock date,
      otherwise the function raises and the capsule stays sealed;
    - the recomputed SHA-256(salt + "\\n" + prediction) must equal the
      stored commitment, otherwise the function raises and the capsule
      stays sealed.
* A failed fetch from every source raises a UserError before any write,
  so the capsule stays sealed and retryable. A revealed capsule can
  never be re-sealed or edited.
* The nondet result carries only strings, never floats: GenVM calldata
  cannot encode floats (the lesson learned the hard way on WeatherProof).

SHA-256, pure Python
--------------------
The hash is implemented below from the FIPS 180-4 constants with no
imports at all, because GenVM's stdlib availability is unproven and the
contract must not depend on hashlib. The implementation is tested
outside the contract against hashlib on vectors including "", "abc",
a 1000-character string, and salt + "\\n" + prediction samples; every
vector must match exactly before deployment.

Limits, stated honestly
-----------------------
* A hash is not encryption: a short, guessable prediction (e.g. "yes")
  can be brute-forced from the commitment by anyone willing to try
  candidates. Seal predictions with enough entropy to matter, and treat
  the commitment as hiding, not as encrypting.
* Losing the reveal key (salt) or forgetting the exact prediction
  means the capsule can never be revealed. There is no recovery: the
  contract never saw the plaintext, so it cannot reconstruct it.
* Reveal granularity is one day (UTC). This contract cannot prove that
  something happened at a precise second.
* Free time APIs carry no SLA. The fallback chain mitigates a single
  outage, but if every listed source is down, revealing waits — it does
  not fall back to an unvalidated clock.
* The seal call itself is deterministic and cannot check "is this date
  in the future", because a deterministic call has no trusted current
  time. The frontend blocks past unlock dates; sealing a past date at
  the contract level simply means the capsule is revealable
  immediately, which is the caller's own choice.
"""

import json

from genlayer import *

TIME_SOURCES = (
    ("https://timeapi.io/api/time/current/zone?timeZone=UTC", "dateTime"),
    ("https://worldtime.timezone.io/api/timezone/Etc/UTC", "utc_datetime"),
)

# -- pure-python SHA-256 (no imports; FIPS 180-4 constants) -------------

_SHA256_K = [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1,
    0x923F82A4, 0xAB1C5ED5, 0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3,
    0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174, 0xE49B69C1, 0xEFBE4786,
    0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147,
    0x06CA6351, 0x14292967, 0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13,
    0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85, 0xA2BFE8A1, 0xA81A664B,
    0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A,
    0x5B9CCA4F, 0x682E6FF3, 0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208,
    0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
]

_SHA256_H0 = [
    0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C,
    0x1F83D9AB, 0x5BE0CD19,
]

_MASK32 = 0xFFFFFFFF
_HEX = "0123456789abcdef"


def _rotr(x: int, n: int) -> int:
    return ((x >> n) | (x << (32 - n))) & _MASK32


def _utf8_bytes(text: str) -> list:
    out = []
    for ch in text:
        cp = ord(ch)
        if cp < 0x80:
            out.append(cp)
        elif cp < 0x800:
            out.append(0xC0 | (cp >> 6))
            out.append(0x80 | (cp & 0x3F))
        elif cp < 0x10000:
            out.append(0xE0 | (cp >> 12))
            out.append(0x80 | ((cp >> 6) & 0x3F))
            out.append(0x80 | (cp & 0x3F))
        else:
            out.append(0xF0 | (cp >> 18))
            out.append(0x80 | ((cp >> 12) & 0x3F))
            out.append(0x80 | ((cp >> 6) & 0x3F))
            out.append(0x80 | (cp & 0x3F))
    return out


def _sha256_hex(text: str) -> str:
    msg = _utf8_bytes(text)
    bit_len = len(msg) * 8
    msg.append(0x80)
    while len(msg) % 64 != 56:
        msg.append(0)
    for shift in (56, 48, 40, 32, 24, 16, 8, 0):
        msg.append((bit_len >> shift) & 0xFF)
    h = list(_SHA256_H0)
    pos = 0
    while pos < len(msg):
        w = []
        i = 0
        while i < 16:
            w.append(
                (msg[pos + i * 4] << 24)
                | (msg[pos + i * 4 + 1] << 16)
                | (msg[pos + i * 4 + 2] << 8)
                | msg[pos + i * 4 + 3]
            )
            i += 1
        i = 16
        while i < 64:
            s0 = _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
            s1 = _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
            w.append(
                (w[i - 16] + s0 + w[i - 7] + s1) & _MASK32
            )
            i += 1
        a = h[0]
        b = h[1]
        c = h[2]
        d = h[3]
        e = h[4]
        f = h[5]
        g = h[6]
        hh = h[7]
        i = 0
        while i < 64:
            big_s1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25)
            ch = (e & f) ^ ((~e & _MASK32) & g)
            temp1 = (hh + big_s1 + ch + _SHA256_K[i] + w[i]) & _MASK32
            big_s0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22)
            maj = (a & b) ^ (a & c) ^ (b & c)
            temp2 = (big_s0 + maj) & _MASK32
            hh = g
            g = f
            f = e
            e = (d + temp1) & _MASK32
            d = c
            c = b
            b = a
            a = (temp1 + temp2) & _MASK32
            i += 1
        h[0] = (h[0] + a) & _MASK32
        h[1] = (h[1] + b) & _MASK32
        h[2] = (h[2] + c) & _MASK32
        h[3] = (h[3] + d) & _MASK32
        h[4] = (h[4] + e) & _MASK32
        h[5] = (h[5] + f) & _MASK32
        h[6] = (h[6] + g) & _MASK32
        h[7] = (h[7] + hh) & _MASK32
        pos += 64
    out = ""
    for value in h:
        for shift in (28, 24, 20, 16, 12, 8, 4, 0):
            out += _HEX[(value >> shift) & 0xF]
    return out


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

    def _check_commitment(self, commitment: str) -> str:
        value = commitment.strip()
        if len(value) != 64:
            raise gl.vm.UserError("EXPECTED: commitment_must_be_64_hex")
        for ch in value:
            if ch not in "0123456789abcdef":
                raise gl.vm.UserError("EXPECTED: commitment_must_be_64_hex")
        return value

    # -- writes ------------------------------------------------------------

    @gl.public.write
    def seal_capsule(
        self,
        question: str,
        commitment: str,
        category: str,
        unlock_date: str,
    ) -> u256:
        question = self._check_text(question, 2, 120, "question")
        commitment = self._check_commitment(commitment)
        category = self._check_text(category, 2, 40, "category")
        unlock_date = unlock_date.strip()
        self._check_date(unlock_date)
        capsule_id = self.next_id
        self.next_id = capsule_id + u256(1)
        # The prediction plaintext is NEVER an argument here and is
        # NEVER stored. Only its SHA-256 commitment goes on-chain.
        record = {
            "id": int(capsule_id),
            "question": question,
            "commitment": commitment,
            "category": category,
            "unlock_date": unlock_date,
            "requester": str(gl.message.sender_address),
            "status": "sealed",
            "revealed_prediction": None,
            "revealed_date": None,
            "source": None,
        }
        self.capsules[capsule_id] = json.dumps(record)
        self.ids.append(capsule_id)
        return capsule_id

    @gl.public.write
    def reveal_capsule(self, capsule_id: u256, prediction: str, salt: str) -> str:
        record = self._load(capsule_id)
        if record["status"] != "sealed":
            raise gl.vm.UserError("EXPECTED: already_revealed")
        unlock_date = record["unlock_date"]
        # The prediction is hashed exactly as supplied: no stripping,
        # no normalisation — the reveal must reproduce the seal-time
        # hash bit for bit. Length is checked on the raw value.
        if len(prediction) < 2 or len(prediction) > 500:
            raise gl.vm.UserError("EXPECTED: prediction_length")
        if len(salt) < 1 or len(salt) > 64:
            raise gl.vm.UserError("EXPECTED: salt_length")

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
        # Deterministic gate 1, after consensus: the agreed UTC date
        # must have reached the unlock date, or nothing is written.
        if result["utc_date"] < unlock_date:
            raise gl.vm.UserError("EXPECTED: not_yet_unlock_date")
        # Deterministic gate 2, after consensus: the recomputed hash
        # must match the stored commitment, or nothing is written.
        computed = _sha256_hex(salt + "\n" + prediction)
        if computed != record["commitment"]:
            raise gl.vm.UserError("EXPECTED: commitment_mismatch")
        record["status"] = "revealed"
        record["revealed_prediction"] = prediction
        record["revealed_date"] = result["utc_date"]
        record["source"] = result["source"]
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
