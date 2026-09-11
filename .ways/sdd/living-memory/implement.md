# implement

Goal: Port living-memory onto master in dependency waves with master as harness truth.
Evidence: 6 waves applied and typechecked incrementally (foundation, canonical adapters, memory core + validator merge, CLI/integrity, tests/docs, regen+migration); memory-targeted 28 tests green; intermediate atomic commits squashed into this gate because inline SDD absorbs implementation in the certification commit.
Decision: Single inline implementation, no task split, rendered adapters regenerated from canonical sources, no harness deletions, both validation conflicts resolved preserving both sides.
Gate: All port waves integrated; proceed to digest-bound review.
