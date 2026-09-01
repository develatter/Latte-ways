import type { HarnessConfig } from "../domain/types.js";

export interface MigrationContext {
  cwd: string;
  config: HarnessConfig;
}

export interface Migration {
  from: string;
  to: string;
  run(context: MigrationContext): Promise<void>;
}

export const MIGRATIONS: Migration[] = [];

export async function runMigrations(context: MigrationContext, target: string): Promise<void> {
  let version = context.config.harnessVersion;
  const visited = new Set<string>();
  while (version !== target) {
    if (visited.has(version)) throw new Error(`Migration cycle at ${version}`);
    visited.add(version);
    const migration = MIGRATIONS.find((candidate) => candidate.from === version);
    if (!migration) throw new Error(`No migration path from ${version} to ${target}`);
    await migration.run(context);
    version = migration.to;
    context.config.harnessVersion = version;
  }
}
