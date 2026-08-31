# @retroport/evidence

Pure, deterministic evidence lifecycle evaluation and faithful-generation gates.

Assertions advance from `UNKNOWN` through `CANDIDATE` and `HYPOTHESIS` only when
their references and predictions are valid. `SUPPORTED` requires evidence from
at least two distinct channels. `VERIFIED` additionally requires a passed,
deterministic supporting experiment whose independent verifier covers every
prediction and uses valid evidence. Only an equally applicable rejecting
experiment can produce `REJECTED`. Faithful generation accepts only non-empty
sets of `SUPPORTED` or `VERIFIED` assertions.
