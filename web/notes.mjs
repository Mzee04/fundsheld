import { isHexString, solidityPackedKeccak256 } from "ethers";

export function noteHash({ note, salt }) {
  return solidityPackedKeccak256(["bytes32", "string"], [salt, note]);
}

export function proofLink(origin, id, note) {
  const url = new URL(`/proof/${id}`, origin);
  if (note) url.hash = new URLSearchParams({ n: note.note, s: note.salt }).toString();
  return url.href;
}

export function noteVerdict(fragment, expectedHash) {
  if (!fragment) return "";
  const fields = new URLSearchParams(fragment.slice(1));
  const note = fields.get("n");
  const salt = fields.get("s");
  return note && isHexString(salt, 32) && noteHash({ note, salt }) === expectedHash
    ? "Note matches" : "Note does not match";
}
