# intake

Goal: Give SDD an explicit execution mode, inline or delegated, and make delegation mechanical: in delegated mode the main session orchestrates and never touches code; implementation always arrives through subagent task integration; implementer, reviewer and qa have separated, opposed objectives.
Evidence: Human direction on 2026-09-02. Today SDD state has only an approval profile; nothing distinguishes inline from delegated work, and nothing stops the orchestrator from committing code directly during implement.
Decision: Scope: state field `execution`, CLI flags, gate enforcement at implement, status projection, Claude guard for Edit/Write in delegated implement, role prompt separation, sdd command guidance for parallel/sequential tasks, docs and tests.
Gate: Proceed to explore.
