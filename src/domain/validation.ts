import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ApprovalRecord, HarnessConfig, ManagedManifest, RemediationRecord, ReviewResult, ValidationFailureRecord, WorkState } from "./types.js";

type SchemaName = "config" | "manifest" | "state" | "task" | "review" | "approval" | "remediation" | "validation-failure";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function validDateTime(value: string): boolean {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth[month - 1]!
    && hour <= 23 && minute <= 59 && second <= 59
    && offsetHour <= 23 && offsetMinute <= 59;
}

const ajv = new Ajv2020({ $data: true, allErrors: true, strict: true });
ajv.addFormat("date-time", { type: "string", validate: validDateTime });

function loadSchema(name: SchemaName): AnySchema {
  const url = new URL(`../../assets/schemas/${name}.schema.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as AnySchema;
}

const taskSchema = loadSchema("task");
const reviewSchema = loadSchema("review");
const remediationSchema = loadSchema("remediation");
const validationFailureSchema = loadSchema("validation-failure");
ajv.addSchema(taskSchema);
ajv.addSchema(reviewSchema);
ajv.addSchema(remediationSchema);
ajv.addSchema(validationFailureSchema);
const validators: Record<Exclude<SchemaName, "task">, ValidateFunction> = {
  config: ajv.compile(loadSchema("config")),
  manifest: ajv.compile(loadSchema("manifest")),
  state: ajv.compile(loadSchema("state")),
  review: ajv.getSchema("https://latte-ways.dev/schemas/review-v1.json")!,
  approval: ajv.compile(loadSchema("approval")),
  remediation: ajv.getSchema("https://latte-ways.dev/schemas/remediation-v1.json")!,
  "validation-failure": ajv.getSchema("https://latte-ways.dev/schemas/validation-failure-v1.json")!,
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

export function validateManifest(value: unknown): value is ManagedManifest {
  return validate("manifest", value).valid;
}

export function validateState(value: unknown): value is WorkState {
  return validate("state", value).valid;
}

export function validateReview(value: unknown): value is ReviewResult {
  return validate("review", value).valid;
}

export function validateApproval(value: unknown): value is ApprovalRecord {
  return validate("approval", value).valid;
}

export function validateRemediation(value: unknown): value is RemediationRecord {
  return validate("remediation", value).valid;
}

export function validateValidationFailure(value: unknown): value is ValidationFailureRecord {
  return validate("validation-failure", value).valid;
}

export function validationDetails(name: keyof typeof validators, value: unknown): ValidationResult {
  return validate(name, value);
}
