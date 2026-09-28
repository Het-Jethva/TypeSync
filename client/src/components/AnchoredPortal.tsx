import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

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
  const [position, setPosition] = useState<{ top: number; left?: number; right?: number } | null>(
    null
  );

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    setPosition(
      align === "right"
        ? {
            top: rect.bottom + offset,
            right: Math.max(window.innerWidth - rect.right, 8),
          }
        : { top: rect.bottom + offset, left: Math.max(rect.left, 8) }
    );
  }, [align, anchorRef, offset]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    // Capture phase, so scrolling of any ancestor repositions the panel.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  if (!position) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        right: position.right,
        zIndex: 50,
      }}
    >
      {children}
    </div>,
    document.body
  );
}
