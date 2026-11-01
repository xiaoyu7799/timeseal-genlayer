/* End-to-end on-chain commit-reveal flow against TimeSeal v2.
 *
 * Usage:
 *   CONTRACT_ADDRESS=0x... GENLAYER_PRIVATE_KEY=0x... node scripts/flow.mjs
 *   # or without a key: an ephemeral account is used (permissionless writes).
 *
 * Steps:
 *   1. Seal capsule #0 for a known secret+salt, unlock date = today
 *      (UTC). The commitment is computed twice — Node createHash and
 *      WebCrypto subtle (the same API the browser uses) — and the two
 *      must agree, which cross-checks the browser computation.
 *   2. Read #0 back and assert the sealed record contains the
 *      commitment and the question ONLY: the prediction plaintext must
 *      not appear anywhere in the record.
 *   3. Reveal #0 with the correct secret+salt (validators fetch the
 *      current UTC date and must agree it has arrived; the contract
 *      recomputes SHA-256 and compares it to the commitment), wait for
 *      FINALIZED, read back: status revealed, prediction present,
 *      revealed_date and source present.
 *   4. Seal capsule #1 with unlock date = tomorrow (UTC) as the locked
 *      demo, so the vault shows a countdown.
 * Writes evidence.json (tx hashes, final status, read-back records).
 * No key is ever written to disk.
 *
 * Deliberately NOT covered on-chain: a wrong-secret reveal. That case
 * is proven by local simulation only (see docs/consensus.md): the
 * pure-Python SHA-256 implementation matches hashlib on matching and
 * mismatching inputs, and the contract raises commitment_mismatch
 * before any write. Sending a doomed on-chain transaction would prove
 * nothing extra and would burn a submission-relevant transaction.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployment = JSON.parse(readFileSync(path.join(root, "deployment.json"), "utf-8"));
const address = process.env.CONTRACT_ADDRESS || deployment.contractAddress;
if (!address) throw new Error("No contract address: set CONTRACT_ADDRESS or run deploy first");

const account = createAccount(process.env.GENLAYER_PRIVATE_KEY || generatePrivateKey());
console.log("Flow account:", account.address);
console.log("Contract:", address);
const client = createClient({ chain: studionet, account });

async function waitFinal(hash, label) {
  console.log(`${label} tx:`, hash);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries: 180,
    interval: 5000,
  });
  console.log(`${label} final:`, receipt.statusName ?? receipt.status);
  return receipt;
}

async function readCapsule(id) {
  const raw = await client.readContract({ address, functionName: "get_capsule", args: [BigInt(id)] });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

const todayUtc = new Date().toISOString().slice(0, 10);
const tomorrowUtc = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

// Capsule #0: the revealable proof capsule.
const question0 = "Will the TimeSeal v2 reveal flow verify its own commitment on-chain?";
const prediction0 = "Yes — the reveal will verify, and the revealed record will carry the date and source.";
const salt0 = "tsv2-demo-key-07";
const commitment0a = createHash("sha256").update(salt0 + "\n" + prediction0).digest("hex");
const buf = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(salt0 + "\n" + prediction0));
const commitment0b = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
if (commitment0a !== commitment0b) throw new Error("Node hash and WebCrypto hash disagree — aborting");
console.log("Commitment #0 (node == webcrypto):", commitment0a);

const sealTx0 = await client.writeContract({
  address,
  functionName: "seal_capsule",
  args: [question0, commitment0a, "Prediction", todayUtc],
  value: 0n,
  leaderOnly: false,
});
await waitFinal(sealTx0, "seal #0");

const sealed0 = await readCapsule(0);
console.log("Sealed record #0:", JSON.stringify(sealed0));
if (sealed0.status !== "sealed" || sealed0.commitment !== commitment0a || sealed0.revealed_prediction !== null) {
  throw new Error("Sealed record #0 does not match the expected sealed shape");
}
if (JSON.stringify(sealed0).includes(prediction0)) {
  throw new Error("FAIL: prediction plaintext found in sealed record #0");
}
console.log("Sealed record #0 contains commitment + question ONLY — no plaintext prediction.");

const revealTx = await client.writeContract({
  address,
  functionName: "reveal_capsule",
  args: [0n, prediction0, salt0],
  value: 0n,
  leaderOnly: false,
});
const revealReceipt = await waitFinal(revealTx, "reveal #0");

const revealed0 = await readCapsule(0);
console.log("Revealed record #0:", JSON.stringify(revealed0, null, 2));
if (revealed0.status !== "revealed" || revealed0.revealed_prediction !== prediction0 || !revealed0.revealed_date || !revealed0.source) {
  throw new Error("Reveal did not produce a fully revealed capsule #0");
}

// Capsule #1: locked demo, unlocks tomorrow (UTC).
// SECURITY NOTE (post-run hardening): the demo secret used in the
// verified run is deliberately NOT written in this committed script.
// A demo capsule whose secret sat in the public repo would not be
// hidden at all. Re-running this script therefore seals a fresh demo
// capsule with a randomly generated secret that is intentionally not
// recorded: it demonstrates the sealed state and countdown only.
const question1 = "Will the locked demo capsule still be sealed tomorrow morning?";
const salt1 = process.env.DEMO_SALT || [...webcrypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
const prediction1 = process.env.DEMO_PREDICTION || `Demo prediction ${Date.now()} — sealed only, secret not recorded.`;
const commitment1 = createHash("sha256").update(salt1 + "\n" + prediction1).digest("hex");
console.log("Demo capsule #1: secret generated at runtime and NOT recorded (sealed-state demo only).");
const sealTx1 = await client.writeContract({
  address,
  functionName: "seal_capsule",
  args: [question1, commitment1, "Prediction", tomorrowUtc],
  value: 0n,
  leaderOnly: false,
});
await waitFinal(sealTx1, "seal #1 (demo)");
const demo1 = await readCapsule(1);
if (demo1.status !== "sealed" || demo1.unlock_date !== tomorrowUtc) {
  throw new Error("Demo capsule #1 is not sealed with tomorrow's unlock date");
}
console.log("Demo capsule #1 sealed, unlock date:", tomorrowUtc);

const evidence = {
  network: "Stable Studionet",
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
  contractAddress: address,
  explorer: `https://explorer-studio.genlayer.com/address/${address}`,
  version: "v2 commit-reveal",
  flowAccount: account.address,
  capsuleId: 0,
  question: question0,
  commitment: commitment0a,
  commitmentCrossCheck: "Node createHash == WebCrypto subtle (browser API) for the same salt + newline + prediction input",
  sealTxHash: sealTx0,
  revealTxHash: revealTx,
  revealReceiptStatus: revealReceipt.statusName ?? ({ 0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING", 4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED", 8: "CANCELED" }[revealReceipt.status] ?? String(revealReceipt.status ?? "")),
  sealedRecord: sealed0,
  record: revealed0,
  demoCapsule: {
    id: 1,
    question: question1,
    commitment: commitment1,
    unlock_date: tomorrowUtc,
    sealTxHash: sealTx1,
    record: demo1,
  },
  mismatchCase: "SIMULATION ONLY — not an on-chain transaction. The contract's pure-Python SHA-256 matches hashlib on matching and mismatching inputs, and reveal_capsule raises EXPECTED: commitment_mismatch before any write on mismatch. No wrong-secret transaction was sent.",
  checkedAt: new Date().toISOString(),
};
writeFileSync(path.join(root, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log("Wrote evidence.json");
