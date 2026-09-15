# explore

Goal: Locate every duplicated legacy lifecycle rule and the compatibility boundaries that a versioned contract must own.
Evidence: `SDD_PHASES` drives execution in `src/work/sdd.ts`, replay in `src/integrity/history.ts`, recovery in `src/repair/repair.ts`, phase validation in `src/work/approve.ts`, and task certification in `src/work/tasks.ts`; human gates live separately in `src/state/status.ts`, and remediation sources/targets are duplicated in history. State already carries `harnessVersion`, while legacy state and commit trailers have no workflow field.
Decision: Introduce one domain workflow contract for legacy SDD v1. Treat an absent workflow version as v1, pin newly opened SDD state explicitly, keep legacy commit trailers/artifacts unchanged, and route all five consumers plus status through contract methods.
Gate: Exploration complete. The refactor boundary and compatibility rule are explicit; no simplified lifecycle or CLI change is required.
