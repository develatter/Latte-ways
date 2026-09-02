# decompose

Goal: Materialize the delegated task graph with dependency-safe integration order.
Evidence: Declared six tasks: memory-core and index-cache ready in parallel; incremental-memory depends on both; release-reconcile depends on memory-core and can run alongside incremental-memory once ready; adapters-migration joins those foundations; baseline-e2e completes repository adoption and cross-cutting verification.
Decision: Use exactly the declared task graph. Implementers own their task worktrees and commits; the orchestrator only prepares, dispatches, and integrates traced commits.
Gate: Every required capability and acceptance criterion maps to a task, dependencies serialize shared integration surfaces, and two safe parallel waves remain available; proceed to implement.
