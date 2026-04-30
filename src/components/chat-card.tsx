import type { ReactNode } from "react";
import {
  ChatCircleDots,
  Checks,
  Infinity as InfinityIcon,
  Play,
  Stop,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LoopPreset } from "@/lib/loopndroll";

export type ChatCardTheme = "orange" | "cyan" | "emerald" | "olive";

export function getChatCardThemeForPreset(preset: LoopPreset | null | undefined): ChatCardTheme {
  if (preset === "await-reply") {
    return "cyan";
  }

  if (preset === "completion-checks") {
    return "emerald";
  }

  if (preset?.startsWith("max-turns-")) {
    return "olive";
  }

  return "orange";
}

const CHAT_CARD_THEME_CLASSES: Record<
  ChatCardTheme,
  {
    card: string;
    marker: string;
    footer: string;
    footerText: string;
    button: string;
  }
> = {
  orange: {
    card: "border-orange-900/20 bg-orange-300 text-orange-950 shadow-none",
    marker: "border-orange-300/20 bg-orange-950/80 text-orange-300",
    footer: "border-t-orange-900/15 bg-orange-400/50",
    footerText: "text-orange-950",
    button:
      "border-orange-950 bg-orange-950 text-orange-200 shadow-none hover:bg-orange-900 hover:text-orange-200 active:scale-[0.98] dark:border-orange-950 dark:bg-orange-950 dark:hover:bg-orange-900 dark:text-orange-200",
  },
  cyan: {
    card: "border-cyan-900/20 bg-cyan-300 text-cyan-950 shadow-none",
    marker: "border-cyan-300/20 bg-cyan-950/80 text-cyan-300",
    footer: "border-t-cyan-900/15 bg-cyan-400/50",
    footerText: "text-cyan-950",
    button:
      "border-cyan-950 bg-cyan-950 text-cyan-200 shadow-none hover:bg-cyan-900 hover:text-cyan-200 active:scale-[0.98] dark:border-cyan-950 dark:bg-cyan-950 dark:hover:bg-cyan-900 dark:text-cyan-200",
  },
  emerald: {
    card: "border-emerald-900/20 bg-emerald-300 text-emerald-950 shadow-none",
    marker: "border-emerald-300/20 bg-emerald-950/80 text-emerald-300",
    footer: "border-t-emerald-900/15 bg-emerald-400/50",
    footerText: "text-emerald-950",
    button:
      "border-emerald-950 bg-emerald-950 text-emerald-200 shadow-none hover:bg-emerald-900 hover:text-emerald-200 active:scale-[0.98] dark:border-emerald-950 dark:bg-emerald-950 dark:hover:bg-emerald-900 dark:text-emerald-200",
  },
  olive: {
    card: "border-olive-900/20 bg-olive-300 text-olive-950 shadow-none",
    marker: "border-olive-300/20 bg-olive-950/80 text-olive-300",
    footer: "border-t-olive-900/15 bg-olive-400/50",
    footerText: "text-olive-950",
    button:
      "border-olive-950 bg-olive-950 text-olive-200 shadow-none hover:bg-olive-900 hover:text-olive-200 active:scale-[0.98] dark:border-olive-950 dark:bg-olive-950 dark:hover:bg-olive-900 dark:text-olive-200",
  },
};

type ChatCardProps = {
  title?: ReactNode;
  description?: ReactNode;
  marker?: ReactNode;
  markerContainerClassName?: string;
  theme?: ChatCardTheme;
  isRunning?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  empty?: boolean;
  loading?: boolean;
  className?: string;
  titleClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  footerStart?: ReactNode;
};

export function ChatCard({
  title,
  description,
  marker,
  markerContainerClassName,
  theme,
  isRunning = false,
  actionLabel = "Start",
  onAction,
  empty = false,
  loading = false,
  className,
  titleClassName,
  contentClassName,
  footerClassName,
  footerStart,
}: ChatCardProps) {
  const placeholder = loading || empty;
  const themedClasses = theme ? CHAT_CARD_THEME_CLASSES[theme] : null;

  return (
    <Card
      aria-busy={loading || undefined}
      aria-hidden={empty || undefined}
      className={cn(
        "size-80 shrink-0 snap-start pb-0",
        themedClasses?.card,
        placeholder && "relative gap-0 overflow-hidden py-0",
        className,
      )}
    >
      <CardContent
        className={cn(
          "flex flex-1 flex-col items-start justify-between",
          placeholder && "p-0",
          contentClassName,
        )}
      >
        {placeholder ? (
          <Skeleton className="size-full rounded-[inherit] bg-white/[0.03]" />
        ) : (
          <>
            <div className="flex flex-col items-start gap-5">
              <div
                className={cn(
                  "flex size-12 items-center justify-center rounded-md",
                  themedClasses
                    ? themedClasses.marker
                    : "border border-white/10 bg-white/4 text-foreground",
                  markerContainerClassName,
                )}
              >
                {marker}
              </div>
              <CardTitle
                className={cn("text-xl leading-snug tracking-normal font-normal", titleClassName)}
              >
                {title}
              </CardTitle>
            </div>
            {description ? (
              <p className="max-w-56 text-xs leading-relaxed tracking-normal opacity-65">
                {description}
              </p>
            ) : null}
          </>
        )}
      </CardContent>

      {!placeholder ? (
        <CardFooter
          className={cn(
            "mt-auto justify-between gap-3 border-t bg-muted/50 px-4 pb-4 [.border-t]:pt-4",
            themedClasses?.footer,
            footerClassName,
          )}
        >
          <div className={cn("min-h-8 min-w-0", themedClasses?.footerText)}>{footerStart}</div>
          <Button
            aria-pressed={isRunning}
            onClick={onAction}
            className={cn("w-20 gap-1.5", themedClasses?.button)}
            size="sm"
            type="button"
            variant="outline"
          >
            {isRunning ? (
              <Stop data-icon="inline-start" weight="fill" />
            ) : (
              <Play data-icon="inline-start" weight="fill" />
            )}
            {isRunning ? "Stop" : actionLabel}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function InfiniteCardIcon() {
  return <InfinityIcon aria-hidden="true" size={32} weight="regular" />;
}

export function AwaitReplyCardIcon() {
  return <ChatCircleDots aria-hidden="true" size={28} weight="regular" />;
}

export function CompletionChecksCardIcon() {
  return <Checks aria-hidden="true" size={28} weight="regular" />;
}

type TurnCountMarkerProps = {
  value: 1 | 2 | 3;
  className?: string;
};

export function TurnCountMarker({ value, className }: TurnCountMarkerProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("text-2xl leading-none tracking-tight font-medium", className)}
    >
      {value}
    </span>
  );
}
