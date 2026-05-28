# blackout_v2_holdback_subset

This folder contains semi-blind adversarial validation datasets from `blackout_v2`.

Run this subset less often, mainly after major semantic-layer changes or Data Summary / Executive Insight confidence changes. Do not tune directly against this set unless a systemic issue appears.

Use it to validate:

- ambiguous source and stage handling
- call-tracking grounding strength
- energy/grid domain separation
- ratio and denominator reliability
- Data Summary and Executive Insight confidence propagation

Do not edit the CSV contents when using this folder as a holdback validation fixture.
