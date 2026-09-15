# assess

Goal: Assess semantic impact of introducing named checks without changing lifecycle or adding environment services.
Evidence: Configuration and validation-failure schemas are strict additionalProperties=false; every existing runChecks caller expects testExitCode; replay must distinguish records that contain new evidence from legacy v1 records.
Decision: Keep schemaVersion 1 and all legacy fields required; add optional commands/check results fields so old config and records remain valid. Define stable check names, required ordering, bounded timeout, spawn-error and process cleanup in one check module.
Gate: Additive design preserves consumers while making invalid contracts fail closed; proceed to specify.
