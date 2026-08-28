import type { ObjectiveDraft } from "./scenario-contract";

export interface ObjectiveApprovalEvidence {
  required: boolean;
  approved: boolean;
  fingerprint: string;
}

export function objectiveFingerprint(objectives: ObjectiveDraft[]): string {
  const input = JSON.stringify(objectives);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `objectives-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
