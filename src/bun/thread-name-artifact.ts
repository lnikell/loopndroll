function normalizeThreadName(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function looksInternalThreadNameArtifact(value: string | null | undefined) {
  const normalized = normalizeThreadName(value);
  if (normalized === null) {
    return false;
  }

  const lowerCased = normalized.toLowerCase();

  return (
    lowerCased.includes("you are a helpful assistant.") ||
    lowerCased.includes("you are a memory writing agent.") ||
    lowerCased.includes("agents.md instructions") ||
    lowerCased.includes("javascript repl") ||
    lowerCased.includes("`js_repl`") ||
    lowerCased.includes("<instructions>") ||
    lowerCased.startsWith("your job:")
  );
}

export function looksStaleStoredThreadName(value: string | null | undefined) {
  const normalized = normalizeThreadName(value);
  if (normalized === null) {
    return true;
  }

  return (
    looksInternalThreadNameArtifact(normalized) ||
    normalized.startsWith("## ") ||
    normalized.startsWith("- ")
  );
}
