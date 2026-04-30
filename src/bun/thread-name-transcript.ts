import { readFile } from "node:fs/promises";

function normalizeLine(value: string) {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isInstructionBoilerplate(line: string) {
  const normalized = line.toLowerCase();
  return (
    normalized.startsWith("agents.md instructions") ||
    /^javascript\s+repl\b/.test(normalized) ||
    normalized === "<instructions>" ||
    normalized === "</instructions>" ||
    normalized.startsWith("you are a memory writing agent.") ||
    normalized.startsWith("your job:")
  );
}

export function deriveThreadNameFromUserText(text: string | null | undefined) {
  if (typeof text !== "string") {
    return null;
  }

  for (const rawLine of text.split("\n")) {
    const line = normalizeLine(rawLine);
    if (line.length === 0 || isInstructionBoilerplate(line)) {
      continue;
    }

    return line.slice(0, 120).trim();
  }

  return null;
}

export async function deriveThreadNameFromTranscript(transcriptPath: string | null | undefined) {
  if (typeof transcriptPath !== "string" || transcriptPath.trim().length === 0) {
    return null;
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    const lines = raw.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      const parsed = JSON.parse(trimmed) as {
        type?: string;
        payload?: {
          type?: string;
          role?: string;
          content?: Array<{ text?: string; type?: string }>;
        };
      };

      if (parsed.type !== "response_item") {
        continue;
      }

      if (parsed.payload?.type !== "message" || parsed.payload.role !== "user") {
        continue;
      }

      const userText = parsed.payload.content
        ?.map((item) => (typeof item.text === "string" ? item.text : null))
        .filter((value): value is string => value !== null)
        .join("\n");

      if (
        typeof userText === "string" &&
        (userText.includes("AGENTS.md instructions") || userText.includes("<INSTRUCTIONS>"))
      ) {
        continue;
      }

      const derived = deriveThreadNameFromUserText(userText);
      if (derived) {
        return derived;
      }
    }
  } catch {
    return null;
  }

  return null;
}
