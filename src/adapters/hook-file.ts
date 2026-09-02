import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stableJson, writeAtomic } from "../fs/files.js";
import type { AdapterIssue, MergeResult } from "./types.js";

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function readJsonObject(cwd: string, path: string): Promise<JsonObject> {
  try {
    const value: unknown = JSON.parse(await readFile(join(cwd, path), "utf8"));
    if (isObject(value)) return value;
    throw new Error(`${path} must contain a JSON object`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export interface HookEntry {
  matcher?: string;
  command?: string;
  [key: string]: unknown;
}

/**
 * Merges harness hook entries into a provider's `hooks.<event>` arrays without
 * touching entries the user owns. `present` decides whether an existing entry
 * already is the harness one, so repeated merges are idempotent.
 */
export function mergeHookEntries(file: JsonObject, wanted: Record<string, HookEntry[]>, present: (entry: unknown, wanted: HookEntry) => boolean): JsonObject {
  const next: JsonObject = { ...file };
  const hooks: JsonObject = isObject(next.hooks) ? { ...next.hooks } : {};
  for (const [event, entries] of Object.entries(wanted)) {
    const existing = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : [];
    for (const entry of entries) {
      if (!existing.some((candidate) => present(candidate, entry))) existing.push(entry);
    }
    hooks[event] = existing;
  }
  next.hooks = hooks;
  return next;
}

export function hasHookEntries(file: JsonObject, wanted: Record<string, HookEntry[]>, present: (entry: unknown, wanted: HookEntry) => boolean): boolean {
  const hooks = isObject(file.hooks) ? file.hooks : {};
  return Object.entries(wanted).every(([event, entries]) => {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    return entries.every((entry) => existing.some((candidate) => present(candidate, entry)));
  });
}

export async function mergeHookFile(cwd: string, path: string, wanted: Record<string, HookEntry[]>, present: (entry: unknown, wanted: HookEntry) => boolean, seed: JsonObject = {}): Promise<MergeResult> {
  const current = await readJsonObject(cwd, path);
  const merged = mergeHookEntries({ ...seed, ...current }, wanted, present);
  await writeAtomic(join(cwd, path), stableJson(merged));
  return { files: [path], notes: [] };
}

export async function verifyHookFile(cwd: string, path: string, provider: string, wanted: Record<string, HookEntry[]>, present: (entry: unknown, wanted: HookEntry) => boolean): Promise<AdapterIssue[]> {
  let file: JsonObject;
  try {
    file = await readJsonObject(cwd, path);
  } catch {
    return [{ code: "adapter-settings-invalid", path, message: `${provider} hook file is unreadable` }];
  }
  if (!hasHookEntries(file, wanted, present)) {
    return [{ code: "adapter-guard-missing", path, message: `guard hook is not configured; run ways adapter install ${provider}` }];
  }
  return [];
}
