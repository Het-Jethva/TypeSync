import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { PortalPositionedContext } from "./overlay-state";

interface AnchoredPortalProps {
  anchorRef: RefObject<HTMLElement | null>;
  /** Which edge of the panel lines up with the matching edge of the anchor. */
  align?: "left" | "right";
  offset?: number;
  children: ReactNode;
}

/**
 * Renders into the body, positioned under an anchor. Overlays that live inside
 * a scrolling or clipping container would otherwise be cut off by it.
 */
export function AnchoredPortal({
  anchorRef,
  align = "left",
  offset = 6,
  children,
}: AnchoredPortalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null
  );

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const rect = anchor.getBoundingClientRect();
    const width = Math.max(panel.getBoundingClientRect().width, panel.scrollWidth);
    const desiredLeft = align === "right" ? rect.right - width : rect.left;
    setPosition({
      top: rect.bottom + offset,
      left: Math.max(8, Math.min(desiredLeft, document.documentElement.clientWidth - width - 8)),
    });
  }, [align, anchorRef, offset]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (panelRef.current) observer.observe(panelRef.current);
    if (panelRef.current?.firstElementChild) observer.observe(panelRef.current.firstElementChild);
    window.addEventListener("resize", measure);
    // Capture phase, so scrolling of any ancestor repositions the panel.
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  return createPortal(
    <div
      ref={panelRef}
      className="[&>*]:max-w-[calc(100vw-16px)]"
      style={{
        position: "fixed",
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
        width: "max-content",
        maxWidth: "calc(100vw - 16px)",
        zIndex: 50,
      }}
    >
      <PortalPositionedContext.Provider value={position !== null}>
        {children}
      </PortalPositionedContext.Provider>
    </div>,
    document.body
  );
}
