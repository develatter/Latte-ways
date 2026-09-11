---
type: plan
status: proposed
work: living-memory-upgrade
---

# Goal

Reanudar living-memory en development desde review con el harness nuevo (remediación) y los fixes RR-005/RR-006, sin merge commits sin trailers y sin borrar worktrees no mergeados.

# Plan

1. Publicar master en 43efd93 (humano: git push origin master). Hotfix ya en fast-forward desde 51d3090, `check --history` verde. No hay merge commit.
2. En development, reconstruir `dist/` con `npm run build` tras cada cambio de rama. `dist/` está ignorado y queda obsoleto al alternar entre harness viejo (development) y nuevo (master); sin rebuild, `ways status` muere con ENOENT/MissingRef.
3. Completar la review pendiente de living-memory con el CLI viejo: rellenar `.ways/sdd/living-memory/review.md`, reviewer independiente con `ways review digest`, `review submit`, `sdd advance` a validate. Registrar el resultado exacto (si validate falla por discovery anidado, es la evidencia base, no un arreglo aún).
4. Decisión humana de upgrade antes de tocar código: el harness viejo no tiene `sdd remediate`. Un `git merge master` en development crearía un commit sin `Harness-*` trailers que el hook rechaza con trabajo activo y que `check --history` marca `history-untraced`. No mergear sin decidir la vía.
5. Vía recomendada: portar el diff del hotfix (vitest `include`, `DIGEST_DIFF` en `src/work/digest.ts`, schemas `remediation`/`validation-failure`, máquina de remediación y tests) como tasks frescas de un intento de remediación una vez opere el CLI nuevo en development. Commits solo vía `task integrate`; prohibido `cherry-pick`/edición directa del orquestador en `implement`.
6. No borrar a mano ninguno de los 6 worktrees `ways/living-memory/*`: verificado con `merge-base` que ninguno está mergeado en development ni en hotfix; pertenecen al SDD activo y el `close` los elimina solo.

# Acceptance

- `origin/master` en 43efd93; `check --history` verde en master.
- `ways status` en development muestra living-memory avanzando con CLI nuevo.
- `scripts/check.sh` y `check --history` verdes en development.
- Cero worktrees/ramas borrados a mano; cero merge commits sin trailers.
