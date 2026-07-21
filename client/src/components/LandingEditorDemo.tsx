import { useEffect, useRef } from "react";

const SIMULATED_TYPING =
  " Collaborative writing is now seamless. You can edit this text right now, format it, or see how fast changes sync. Try typing here!";

export function LandingEditorDemo() {
  const demoRef = useRef<HTMLDivElement>(null);
  const paragraphRef = useRef<HTMLParagraphElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const hasInteractedRef = useRef(false);
  const currentCharIndexRef = useRef(0);

  useEffect(() => {
    const paragraph = paragraphRef.current;
    const cursor = cursorRef.current;
    if (!paragraph || !cursor) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    const timer = window.setInterval(() => {
      if (hasInteractedRef.current) {
        window.clearInterval(timer);
        return;
      }

      const index = currentCharIndexRef.current;
      if (index >= SIMULATED_TYPING.length) {
        window.clearInterval(timer);
        return;
      }

      paragraph.insertBefore(
        document.createTextNode(SIMULATED_TYPING[index]),
        cursor
      );
      currentCharIndexRef.current += 1;
      cursor.style.opacity = "1";
    }, 90);

    return () => window.clearInterval(timer);
  }, []);

  const handleInput = () => {
    hasInteractedRef.current = true;
    if (cursorRef.current) cursorRef.current.style.opacity = "0";
  };

  return (
    <div
      className="relative border border-border-strong bg-bg-secondary/30 rounded-md overflow-hidden shadow-sm hover:border-border-accent transition-[border-color] cursor-text max-w-2xl mx-auto"
      onClick={() => demoRef.current?.focus()}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-secondary/40 select-none">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-border-strong" />
          <span className="w-2 h-2 rounded-full bg-border-strong" />
          <span className="w-2 h-2 rounded-full bg-border-strong" />
          <span className="text-[10px] text-text-secondary font-medium ml-1.5">
            demo_document.md
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex -space-x-1" aria-hidden="true">
            <span className="w-4 h-4 rounded bg-bg-tertiary border border-border text-[8px] font-bold text-text-primary flex items-center justify-center">
              Y
            </span>
            <span className="w-4 h-4 rounded bg-accent border border-border text-[8px] font-bold text-white flex items-center justify-center">
              S
            </span>
          </div>
          <span className="flex items-center gap-1 text-[10px] text-success font-medium">
            <span className="w-1 h-1 rounded-full bg-success animate-pulse" aria-hidden="true" />
            Live
          </span>
        </div>
      </div>

      <div className="relative p-1 min-h-[180px] bg-bg-elevated">
        <div
          ref={demoRef}
          role="textbox"
          aria-label="Interactive collaborative writing demo"
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          className="prose prose-sm dark:prose-invert focus:outline-none focus-visible:ring-2 focus-visible:ring-accent min-h-[160px] text-xs leading-relaxed text-text-primary px-4 py-3 font-serif"
        >
          <h2>Collaborative Document</h2>
          <p ref={paragraphRef}>
            Welcome to TypeSync. This is a live interactive editor demonstration.
            <span
              ref={cursorRef}
              aria-hidden="true"
              className="inline-flex align-baseline ml-0.5 items-start opacity-0 transition-opacity duration-75"
            >
              <span className="h-4 w-[1.5px] bg-accent" />
              <span className="-mt-4 ml-0.5 text-[8px] font-medium bg-accent text-white px-1 py-0.25 rounded-sm rounded-tl-none whitespace-nowrap">
                Sarah
              </span>
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
