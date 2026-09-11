const REGEX_SPECIAL = /[|\\{}()[\]^$+?.]/g;

export function normalizeRepoPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Path must be repository-relative: ${path}`);
  }
  return normalized;
}

export function normalizeGlob(pattern: string): string {
  let normalized = normalizeRepoPath(pattern);
  if (normalized.endsWith("/")) normalized += "**";
  return normalized;
}

export function globRegex(pattern: string): RegExp {
  const glob = normalizeGlob(pattern);
  let expression = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index] ?? "";
    if (character === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          expression += "(?:.*/)?";
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(REGEX_SPECIAL, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globRegex(pattern).test(normalizeRepoPath(path));
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}
