function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function deriveTelegramProjectLabel(cwd: string | null | undefined) {
  if (typeof cwd !== "string") {
    return "Projectless";
  }

  const normalized = cwd
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (normalized.length === 0) {
    return "Projectless";
  }

  return compactWhitespace(normalized[normalized.length - 1] ?? "");
}

export function formatTelegramSessionLabel(input: {
  cwd?: string | null;
  sessionRef?: string | null;
  title?: string | null;
}) {
  const firstLineSegments: string[] = [];
  const projectLabel = deriveTelegramProjectLabel(input.cwd ?? null);
  if (projectLabel) {
    firstLineSegments.push(`[${projectLabel}]`);
  }

  const sessionRef =
    typeof input.sessionRef === "string" && input.sessionRef.trim().length > 0
      ? input.sessionRef.trim().toUpperCase()
      : null;
  if (sessionRef) {
    firstLineSegments.push(`[${sessionRef}]`);
  }

  const title =
    typeof input.title === "string" && input.title.trim().length > 0
      ? `Thread: ${compactWhitespace(input.title)}`
      : null;

  const lines = [firstLineSegments.join(" "), title].filter(
    (line): line is string => typeof line === "string" && line.length > 0,
  );

  return lines.join("\n");
}

function appendTelegramChunkLabel(header: string, chunkLabel: string | null) {
  if (!chunkLabel) {
    return header;
  }

  const [firstLine, ...restLines] = header.split("\n");
  const labeledFirstLine =
    typeof firstLine === "string" && firstLine.length > 0
      ? `${firstLine} ${chunkLabel}`
      : chunkLabel;

  return [labeledFirstLine, ...restLines].join("\n");
}

export function normalizeTelegramOutputText(message: string | null | undefined) {
  const normalized = String(message ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*([-*])\s+\[ \]\s+/gm, "- ")
    .replace(/^\s*([-*])\s+\[[xX]\]\s+/gm, "- [done] ")
    .replace(/^\s*-\s*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized;
}

function buildTelegramNotificationFooter(
  sessionRef: string | null | undefined,
  preset: string | null | undefined,
  telegramNotificationFooter: string,
) {
  const replyCommandFooter =
    typeof sessionRef === "string" && sessionRef.trim().length > 0
      ? `Or send /reply ${sessionRef.trim().toUpperCase()} your message.`
      : null;

  const segments: string[] = [];
  if (preset === "await-reply" || preset === "completion-checks") {
    segments.push("---------", telegramNotificationFooter);
  } else if (
    preset === "infinite" ||
    preset === "max-turns-1" ||
    preset === "max-turns-2" ||
    preset === "max-turns-3"
  ) {
    segments.push(
      "---------",
      "Reply to this message in Telegram to replace the prompt that will keep being sent to this Codex chat.",
    );
  }

  if (replyCommandFooter) {
    segments.push(replyCommandFooter);
  }

  return segments.join("\n\n");
}

function splitTelegramMessageChunk(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return {
      chunk: text,
      rest: "",
    };
  }

  const candidateIndexes = [
    text.lastIndexOf("\n\n", maxLength),
    text.lastIndexOf("\n", maxLength),
    text.lastIndexOf(" ", maxLength),
  ].filter((index) => index >= 0);

  let splitIndex = candidateIndexes.length > 0 ? Math.max(...candidateIndexes) : -1;
  if (splitIndex < Math.floor(maxLength * 0.5)) {
    splitIndex = maxLength;
  }

  const chunk = text.slice(0, splitIndex).trimEnd();
  const rest = text.slice(splitIndex).trimStart();

  if (chunk.length === 0) {
    return {
      chunk: text.slice(0, maxLength).trimEnd(),
      rest: text.slice(maxLength).trimStart(),
    };
  }

  return { chunk, rest };
}

export function buildTelegramNotificationChunks(input: {
  cwd?: string | null;
  sessionRef?: string | null;
  sessionTitle?: string | null;
  message?: string | null;
  preset?: string | null;
  telegramNotificationFooter: string;
  maxLength: number;
}) {
  const title = compactWhitespace(input.sessionTitle ?? "");
  const header = formatTelegramSessionLabel({
    cwd: input.cwd ?? null,
    sessionRef: input.sessionRef ?? null,
    title,
  });
  const body = normalizeTelegramOutputText(input.message ?? "");
  if (body.length === 0) {
    return [];
  }

  const footer = buildTelegramNotificationFooter(
    input.sessionRef ?? null,
    input.preset ?? null,
    input.telegramNotificationFooter,
  );
  const baseBodyLimit = Math.max(1, input.maxLength);
  const bodyChunks: string[] = [];
  let remaining = body;

  while (remaining.length > 0) {
    const { chunk, rest } = splitTelegramMessageChunk(remaining, baseBodyLimit);
    bodyChunks.push(chunk);
    remaining = rest;
  }

  let totalChunks = bodyChunks.length;
  const renderChunk = (chunk: string, index: number, count: number) => {
    const chunkLabel = count > 1 ? `(${index + 1}/${count})` : null;
    const segments: string[] = [];

    if (index === 0) {
      if (header) {
        segments.push(appendTelegramChunkLabel(header, chunkLabel));
      } else if (chunkLabel) {
        segments.push(chunkLabel);
      }
    } else if (chunkLabel) {
      segments.push(chunkLabel);
    }

    if (index === 0 && header) {
      segments.push("---------");
    }

    segments.push(chunk);

    if (index === count - 1 && footer.length > 0) {
      segments.push(footer);
    }

    return segments.join("\n\n");
  };

  while (true) {
    const rendered = bodyChunks.map((chunk, index) => renderChunk(chunk, index, totalChunks));
    const oversizedIndex = rendered.findIndex((chunk) => chunk.length > input.maxLength);
    if (oversizedIndex === -1) {
      return rendered;
    }

    const currentChunk = bodyChunks[oversizedIndex] ?? "";
    const renderedChunk = rendered[oversizedIndex] ?? "";
    const overflow = Math.max(1, renderedChunk.length - input.maxLength);
    const splitLimit = Math.max(
      1,
      currentChunk.length - overflow - Math.ceil(input.maxLength * 0.1),
    );
    const { chunk, rest } = splitTelegramMessageChunk(currentChunk, splitLimit);
    bodyChunks.splice(oversizedIndex, 1, chunk, rest);
    totalChunks = bodyChunks.length;
  }
}

export const TELEGRAM_OUTPUT_HOOK_SOURCE = [
  compactWhitespace,
  deriveTelegramProjectLabel,
  formatTelegramSessionLabel,
  appendTelegramChunkLabel,
  normalizeTelegramOutputText,
  buildTelegramNotificationFooter,
  splitTelegramMessageChunk,
  buildTelegramNotificationChunks,
]
  .map((fn) => fn.toString())
  .join("\n\n");
