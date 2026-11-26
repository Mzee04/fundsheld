import { getAddress, isAddress, isHexString, solidityPackedKeccak256 } from "ethers";

export function noteHash({ note, salt }) {
  return solidityPackedKeccak256(["bytes32", "string"], [salt, note]);
}

// Proof links name the chain and vault they belong to, so a link cannot be read against another deployment.
export function proofLink(origin, id, note, scope) {
  const url = new URL(`/proof/${id}`, origin);
  if (scope) url.search = new URLSearchParams({ chain: String(scope.chainId), vault: getAddress(scope.vault) }).toString();
  if (note) url.hash = new URLSearchParams({ n: note.note, s: note.salt }).toString();
  return url.href;
}

// Returns "" for a link without scope (older links), "match", or "mismatch".
export function linkScope(search, scope) {
  const fields = new URLSearchParams(search);
  const chain = fields.get("chain");
  const vault = fields.get("vault");
  if (chain === null && vault === null) return "";
  if (chain !== String(scope.chainId) || !vault || !isAddress(vault)) return "mismatch";
  return getAddress(vault) === getAddress(scope.vault) ? "match" : "mismatch";
}

export function readNote(fragment, expectedHash) {
  if (!fragment || fragment === "#") return { verdict: "" };
  const fields = new URLSearchParams(fragment.slice(1));
  const note = fields.get("n");
  const salt = fields.get("s");
  if (note && isHexString(salt, 32) && noteHash({ note, salt }) === expectedHash) return { verdict: "Note matches", note };
  return { verdict: "Note does not match" };
}

export function noteVerdict(fragment, expectedHash) {
  return readNote(fragment, expectedHash).verdict;
}
