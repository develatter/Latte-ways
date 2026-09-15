# Reproducible evals

`ways evals run` runs a fixed functional corpus in a fresh disposable Git repository per task. The developer checkout is never passed to an adapter. Results are JSON and identify corpus revision, actual fixture Git revision, A/B harness label, model, seed, budgets, adapter argv, every session, functional checks, timings and usage availability.

```sh
npx ways evals run --adapter=fake --harness=checks-only --model=fake-model --revision=corpus-v2 --seed=7 --output=eval-result.json
```

Use `--harness=no-ways` for the comparison configuration. Only `no-ways` and `checks-only` are accepted. This label and `--model`, revision, seed and adapter argv are passed to every session and recorded unchanged.

## Manual real adapter

```sh
npx ways evals run --adapter=command --command=/path/to/real-harness \
  --arg=--non-interactive --harness=no-ways --model=my-model \
  --revision=corpus-v2 --seed=7 --timeout-ms=120000 --output=manual.json
```

The command runs with the disposable repository as its cwd. Environment variables provide `WAYS_EVAL_TASK_ID`, `WAYS_EVAL_REPOSITORY`, `WAYS_EVAL_SESSION`, `WAYS_EVAL_HARNESS`, `WAYS_EVAL_MODEL`, `WAYS_EVAL_STARTING_REVISION`, `WAYS_EVAL_PROMPT` and `WAYS_EVAL_SEED`. Print a final JSON line such as `{"doneClaim":true}`. Optional `usage` fields are accumulated across sessions; if any session omits metrics, the task explicitly reports unavailable values as `null`, never zero.

Adapters are terminated as process trees on timeout or output-budget overflow (SIGTERM, then SIGKILL escalation) and the runner waits for process closure before cleanup. Each functional criterion is an argv command with exact expected exit/stdout/stderr, graded independently of done claims. Synthetic fake-adapter results are task-outcome evidence only and are not architectural benchmarks.
