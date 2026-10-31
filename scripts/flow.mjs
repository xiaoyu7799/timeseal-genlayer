/* End-to-end on-chain flow against an already-deployed TimeSeal contract.
 *
 * Usage:
 *   CONTRACT_ADDRESS=0x... GENLAYER_PRIVATE_KEY=0x... node scripts/flow.mjs
 *   # or without a key: an ephemeral account is used (permissionless writes).
 *
 * Steps: seal a capsule whose unlock date is today (UTC) -> unlock it
 * on-chain (validators fetch the current UTC date and must agree it has
 * reached the unlock date) -> read it back. Sealing with today's date is
 * deliberate here: it proves the unlock path end-to-end without waiting
 * a day. The website itself only lets users pick future unlock dates.
 * Writes evidence.json (tx hashes, final status, unlocked record). No key
 * is ever written to disk.
 */
import { readFileSync, writeFileSync } from "node:fs";
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

const todayUtc = new Date().toISOString().slice(0, 10);
const sealTx = await client.writeContract({
  address,
  functionName: "seal_capsule",
  args: ["TimeSeal genesis capsule", "Sealed at launch to prove the full seal -> unlock flow on Stable Studionet.", "Prediction", todayUtc],
  value: 0n,
  leaderOnly: false,
});
await waitFinal(sealTx, "seal");

const countRaw = await client.readContract({ address, functionName: "get_count", args: [] });
const count = Number(countRaw);
console.log("Capsule count:", count);
const id = BigInt(count - 1);

const unlockTx = await client.writeContract({
  address,
  functionName: "unlock_capsule",
  args: [id],
  value: 0n,
  leaderOnly: false,
});
const unlockReceipt = await waitFinal(unlockTx, "unlock");

const recordRaw = await client.readContract({
  address,
  functionName: "get_capsule",
  args: [id],
});
const record = typeof recordRaw === "string" ? JSON.parse(recordRaw) : recordRaw;
console.log("Unlocked record:", JSON.stringify(record, null, 2));
if (record.status !== "unlocked" || !record.unlocked_date) {
  throw new Error("Flow did not produce an unlocked capsule");
}

const evidence = {
  network: "Stable Studionet",
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
  contractAddress: address,
  explorer: `https://explorer-studio.genlayer.com/address/${address}`,
  flowAccount: account.address,
  capsuleId: Number(id),
  sealTxHash: sealTx,
  unlockTxHash: unlockTx,
  unlockReceiptStatus: unlockReceipt.statusName ?? ({ 0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING", 4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED", 8: "CANCELED" }[unlockReceipt.status] ?? String(unlockReceipt.status ?? "")),
  record,
  checkedAt: new Date().toISOString(),
};
writeFileSync(path.join(root, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log("Wrote evidence.json");
