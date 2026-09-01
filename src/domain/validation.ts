import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { HarnessConfig, ReviewResult, WorkState } from "./types.js";

type SchemaName = "config" | "state" | "task" | "review";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);

function loadSchema(name: SchemaName): AnySchema {
  const url = new URL(`../../assets/schemas/${name}.schema.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as AnySchema;
}

ajv.addSchema(loadSchema("task"));
const validators: Record<Exclude<SchemaName, "task">, ValidateFunction> = {
  config: ajv.compile(loadSchema("config")),
  state: ajv.compile(loadSchema("state")),
  review: ajv.compile(loadSchema("review")),
};

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
}

function validate(name: keyof typeof validators, value: unknown): ValidationResult {
  const validator = validators[name];
  const valid = validator(value);
  return { valid, errors: valid ? [] : formatErrors(validator.errors) };
}

export function validateConfig(value: unknown): value is HarnessConfig {
  return validate("config", value).valid;
}

export function validateState(value: unknown): value is WorkState {
  return validate("state", value).valid;
}

export function validateReview(value: unknown): value is ReviewResult {
  return validate("review", value).valid;
}

export function validationDetails(name: keyof typeof validators, value: unknown): ValidationResult {
  return validate(name, value);
}
