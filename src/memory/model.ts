export const COVERAGE_CLASSIFICATIONS = [
  "concept-backed",
  "implementation-detail",
  "derived-or-cosmetic",
] as const;

export type CoverageClassification = (typeof COVERAGE_CLASSIFICATIONS)[number];

/** A repository-local source starts with `/`; other URI schemes are external evidence. */
export interface MemorySource {
  resource: string;
  kind?: "path" | "glob";
  /** Commit at whose code tree this source was reviewed. */
  revision?: string;
}

export interface ReviewedCodeTree {
  revision: string;
  digest: string;
  reviewDigest: string;
}

export interface CoverageArea {
  schemaVersion: 1;
  id: string;
  globs: string[];
  classification: CoverageClassification;
  concepts: string[];
}

export interface MemoryState {
  schemaVersion: 1;
  generation: number;
  watermark: ReviewedCodeTree;
}

export interface ReconciliationDisposition {
  path: string;
  outcome: "updated" | "confirmed" | "implementation-detail" | "derived-or-cosmetic" | "removed";
  concepts: string[];
}

export interface ReconciliationEvidence {
  schemaVersion: 1;
  generation: number;
  base: string;
  candidate: string;
  target: string;
  codeTreeDigest: string;
  reviewDigest: string;
  dispositions: ReconciliationDisposition[];
}

export interface MemoryIssue {
  code: string;
  path: string;
  message: string;
}
