# explore

Goal: Identify seams for adapter rendering, manifest extension, and upgrade.
Evidence: MANAGED_ASSETS in src/bootstrap/bootstrap.ts is a flat list rendered by copy; adapters need templating (frontmatter rewrite, name prefix) so they get their own installer rather than reusing installFile. ManagedManifest (assets/schemas/manifest.schema.json) has additionalProperties false; adding `adapters: { <provider>: { <path>: sha } }` needs schema and type updates. checkIntegrity iterates manifest.managedFiles only; it must also walk adapters. applyUpgrade re-copies MANAGED_ASSETS; it must re-render installed adapters. Existing agent prompts in assets/bootstrap/agents are the neutral role bodies; the four bootstrap copies under .ways/agents stay as-is for other providers. Claude settings.json may already exist in consumer repos, so the adapter merges keys and only hashes files it fully owns.
Decision: New module src/adapters/{types,source,claude,install}.ts; manifest gains `adapters`; integrity and upgrade extended; settings.json merged and excluded from hashing.
Gate: Proceed to assess.
