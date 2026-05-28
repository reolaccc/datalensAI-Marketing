import type { PatchLayerPolicy } from "./types.js";

export const PATCH_LAYER_POLICY: PatchLayerPolicy = {
  requiredFields: [
    "rule id",
    "owner",
    "reason for temporary handling",
    "dataset or customer scope",
    "planned removal condition"
  ],
  bannedBehaviors: [
    "silent promotion of dataset-specific rules into core routing",
    "unbounded alias additions without scope tags",
    "cross-domain wording changes hidden inside a patch",
    "temporary fixes that override deterministic trust gates"
  ],
  removalExpectation: "Temporary semantic patches should be easy to isolate, tagged explicitly, and removed once generalized logic or cleaner exports make them unnecessary."
};
