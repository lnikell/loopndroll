import { DotsThreeVertical } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AwaitReplyCardIcon,
  ChatCard,
  CompletionChecksCardIcon,
  InfiniteCardIcon,
  TurnCountMarker,
  type ChatCardTheme,
} from "@/components/chat-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  CompletionCheck,
  LoopPreset,
  LoopSession,
  LoopndrollSnapshot,
} from "@/lib/loopndroll";
import { cn } from "@/lib/utils";

const globalPresets: Array<{
  preset: LoopPreset;
  title: string;
  description: string;
  marker: ReactNode;
  theme: ChatCardTheme;
  markerContainerClassName?: string;
}> = [
  {
    preset: "infinite",
    title: "Infinite",
    description: "Keep Codex moving with the continue prompt until you stop it.",
    marker: <InfiniteCardIcon />,
    theme: "orange",
  },
  {
    preset: "await-reply",
    title: "Await Reply",
    description: "Notify Telegram, then wait for your reply before continuing.",
    marker: <AwaitReplyCardIcon />,
    theme: "cyan",
  },
  {
    preset: "completion-checks",
    title: "Completion Checks",
    description: "Run your checks at Stop and continue only when they pass.",
    marker: <CompletionChecksCardIcon />,
    theme: "emerald",
  },
  {
    preset: "max-turns-1",
    title: "Max Turns",
    description: "Allow one more continuation, then let Codex stop.",
    marker: <TurnCountMarker className="-ml-0.5" value={1} />,
    theme: "olive",
    markerContainerClassName: "-ml-0.5",
  },
  {
    preset: "max-turns-2",
    title: "Max Turns",
    description: "Allow two more continuations before stopping.",
    marker: <TurnCountMarker value={2} />,
    theme: "olive",
  },
  {
    preset: "max-turns-3",
    title: "Max Turns",
    description: "Allow three more continuations before stopping.",
    marker: <TurnCountMarker value={3} />,
    theme: "olive",
  },
];

const sessionPresets: Array<{ preset: LoopPreset; label: string }> = [
  { preset: "infinite", label: "Infinite" },
  { preset: "await-reply", label: "Await Reply" },
  { preset: "completion-checks", label: "Completion Checks" },
  { preset: "max-turns-1", label: "Max Turns 1" },
  { preset: "max-turns-2", label: "Max Turns 2" },
  { preset: "max-turns-3", label: "Max Turns 3" },
];

export const sessionPresetItems = sessionPresets.map((item) => ({
  label: item.label,
  value: item.preset,
}));

const easeOut = [0.23, 1, 0.32, 1] as const;
export const staggerContainerVariants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.06,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
};
export const contentFadeVariants = {
  hidden: {
    opacity: 0,
    y: 8,
    filter: "blur(6px)",
  },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      duration: 0.28,
      ease: easeOut,
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    filter: "blur(4px)",
    transition: {
      duration: 0.14,
      ease: easeOut,
    },
  },
};
export const emptyStateVariants = {
  hidden: {
    opacity: 0,
  },
  show: {
    opacity: 1,
    transition: {
      duration: 0.18,
      ease: easeOut,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.12,
      ease: easeOut,
    },
  },
};
export const rowStaggerVariants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.02,
      staggerDirection: -1,
    },
  },
};
const SESSION_TIMING_WAVE_DURATION_MS = 280;

function stripMarkdownTitle(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|\s)(?:#{1,6}\s+|>\s+|\d+\.\s+|[-+*]\s+)/gm, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\\([\\`*_#[\]~>])/g, "$1")
    .replace(/[\\`*_#[\]~>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSessionNumber(session: LoopSession, fallbackNumber: number) {
  const codexNumber = /^\d+$/.test(session.threadId)
    ? Number.parseInt(session.threadId, 10)
    : undefined;
  return typeof codexNumber === "number" && Number.isSafeInteger(codexNumber) && codexNumber > 0
    ? codexNumber
    : fallbackNumber;
}

export function getSessionRef(session: LoopSession, fallbackNumber: number) {
  return session.sessionRef?.trim() || `C${getSessionNumber(session, fallbackNumber)}`;
}

export function getSessionPrompt(session: LoopSession) {
  if (!session.threadName) {
    return null;
  }

  const prompt = stripMarkdownTitle(session.threadName);
  return prompt || null;
}

export function AnimatedEmptyStateMessage({ text }: { text: string }) {
  const characters = [...text];
  const totalCharacters = characters.length;

  return (
    <span aria-label={text} className="inline-flex flex-wrap">
      {characters.map((character, index) => (
        <span
          key={`${character}-${index}`}
          aria-hidden="true"
          className="empty-state-letter"
          style={
            {
              "--empty-letter-delay": `${(totalCharacters - index - 1) * -0.045}s`,
            } as CSSProperties
          }
        >
          {character === " " ? "\u00A0" : character}
        </span>
      ))}
    </span>
  );
}

export function SessionTimingText({ text }: { text: string }) {
  const [animationVersion, setAnimationVersion] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const previousLengthRef = useRef(text.length);

  useEffect(() => {
    const previousLength = previousLengthRef.current;
    previousLengthRef.current = text.length;

    if (previousLength === text.length || text.length === 0) {
      return;
    }

    setAnimationVersion((current) => current + 1);
    setIsAnimating(true);

    const timeoutId = window.setTimeout(() => {
      setIsAnimating(false);
    }, SESSION_TIMING_WAVE_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [text]);

  return (
    <span aria-label={text} className="inline-flex min-w-0 whitespace-nowrap text-left">
      {[...text].map((character, index) => (
        <span
          key={isAnimating ? `${animationVersion}-${index}-${character}` : index}
          aria-hidden="true"
          className={cn("chat-timing-letter", isAnimating && "chat-timing-letter--animated")}
          style={
            {
              "--chat-timing-delay": `${Math.min(index * 0.012, 0.12)}s`,
            } as CSSProperties
          }
        >
          {character === " " ? "\u00A0" : character}
        </span>
      ))}
    </span>
  );
}

export function ChatCardRail({
  activePreset,
  onToggle,
  renderFooterStart,
}: {
  activePreset: LoopPreset | null;
  onToggle: (preset: LoopPreset) => void;
  renderFooterStart?: (preset: LoopPreset) => ReactNode;
}) {
  return (
    <div className="-mx-16 min-w-0 overflow-hidden">
      <div className="flex snap-x snap-mandatory gap-5 overflow-x-auto pl-16 pr-16 pt-1 pb-2 [scroll-padding-left:4rem] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {globalPresets.map((item) => (
          <ChatCard
            key={item.preset}
            theme={item.theme}
            isRunning={activePreset === item.preset}
            marker={item.marker}
            markerContainerClassName={item.markerContainerClassName}
            onAction={() => onToggle(item.preset)}
            footerStart={renderFooterStart?.(item.preset)}
            title={item.title}
            description={item.description}
          />
        ))}
      </div>
    </div>
  );
}

export function GlobalCompletionCheckFooter({
  completionChecks,
  onUpdateConfig,
  snapshot,
}: {
  completionChecks: CompletionCheck[];
  onUpdateConfig: (completionCheckId: string | null, waitForReplyAfterCompletion: boolean) => void;
  snapshot: LoopndrollSnapshot | null;
}) {
  const hasConfiguredGlobalCompletionCheck = snapshot?.globalCompletionCheckId !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Configure Completion checks preset"
        render={
          <Button
            className="-ml-[10px] text-emerald-950 hover:!border-emerald-950/30 hover:!bg-transparent hover:text-emerald-950 aria-expanded:!border-emerald-950 aria-expanded:!bg-emerald-950 aria-expanded:!text-emerald-200 dark:hover:!bg-transparent dark:aria-expanded:!bg-emerald-950"
            variant="ghost"
            size="icon-sm"
          />
        }
      >
        <DotsThreeVertical aria-hidden="true" weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={snapshot?.globalCompletionCheckId === null}
            onCheckedChange={() => {
              onUpdateConfig(null, false);
            }}
          >
            None
          </DropdownMenuCheckboxItem>
          {completionChecks.length === 0 ? (
            <DropdownMenuItem disabled>No checks available</DropdownMenuItem>
          ) : (
            completionChecks.map((completionCheck) => (
              <DropdownMenuCheckboxItem
                key={completionCheck.id}
                checked={snapshot?.globalCompletionCheckId === completionCheck.id}
                onCheckedChange={() => {
                  onUpdateConfig(
                    completionCheck.id,
                    snapshot?.globalCompletionCheckWaitForReply ?? false,
                  );
                }}
              >
                {completionCheck.label}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={snapshot?.globalCompletionCheckWaitForReply ?? false}
            disabled={!hasConfiguredGlobalCompletionCheck}
            onCheckedChange={(checked) => {
              onUpdateConfig(snapshot?.globalCompletionCheckId ?? null, Boolean(checked));
            }}
          >
            Wait For Reply
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
