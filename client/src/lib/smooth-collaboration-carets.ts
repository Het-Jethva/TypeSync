import { isValidCSSStyleValue } from "@tiptap/core";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { yCursorPlugin, yCursorPluginKey } from "@tiptap/y-tiptap";

const DEFAULT_CARET_COLOR = "#5a6b7c";

function sanitizeUserColor(user: Record<string, unknown>) {
  return {
    ...user,
    color:
      isValidCSSStyleValue(user.color) && /^#[0-9a-fA-F]{6}$/.test(user.color)
        ? user.color
        : "transparent",
  };
}

export const SmoothCollaborationCaret = CollaborationCaret.extend({
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];
    return plugins.map((plugin) =>
      plugin.spec.key === yCursorPluginKey
        ? yCursorPlugin(this.options.provider.awareness, {
            cursorBuilder: (user: Record<string, unknown>, clientId: number) =>
              renderCollaborationCaretMarker(sanitizeUserColor(user), clientId),
            selectionBuilder: (user: Record<string, unknown>) =>
              this.options.selectionRender(sanitizeUserColor(user)),
          })
        : plugin
    );
  },
});

interface AwarenessEvents {
  on(event: "update", handler: () => void): void;
  off(event: "update", handler: () => void): void;
}

function safeUserValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function renderCollaborationCaretMarker(
  user: Record<string, unknown>,
  clientId: number
): HTMLElement {
  const marker = document.createElement("span");
  const name = safeUserValue(user.name, "Collaborator");
  const color = safeUserValue(user.color, DEFAULT_CARET_COLOR);
  const identity = `client-${clientId}`;

  marker.classList.add("collaboration-carets__marker");
  marker.dataset.collaborationCaretId = identity;
  marker.dataset.collaborationCaretName = name;
  marker.dataset.collaborationCaretColor = color;
  marker.setAttribute("aria-hidden", "true");

  return marker;
}

export function mountSmoothCollaborationCarets(
  editorElement: HTMLElement,
  overlayContainer: HTMLElement,
  awareness: AwarenessEvents
): () => void {
  const overlays = new Map<string, HTMLElement>();
  const activationFrames = new Set<number>();
  let updateFrame: number | null = null;

  const updateOverlays = () => {
    updateFrame = null;
    const containerRect = overlayContainer.getBoundingClientRect();
    const activeIds = new Set<string>();
    const markers = editorElement.querySelectorAll<HTMLElement>(
      "[data-collaboration-caret-id]"
    );

    for (const marker of markers) {
      const id = marker.dataset.collaborationCaretId;
      if (!id) continue;

      activeIds.add(id);
      const markerRect = marker.getBoundingClientRect();
      const name = marker.dataset.collaborationCaretName ?? "Collaborator";
      const color = marker.dataset.collaborationCaretColor ?? DEFAULT_CARET_COLOR;
      let overlay = overlays.get(id);

      if (!overlay) {
        overlay = document.createElement("span");
        overlay.classList.add("collaboration-carets__overlay");
        overlay.setAttribute("aria-hidden", "true");

        const label = document.createElement("span");
        label.classList.add("collaboration-carets__overlay-label");
        overlay.append(label);
        overlayContainer.append(overlay);
        overlays.set(id, overlay);

        const activationFrame = window.requestAnimationFrame(() => {
          activationFrames.delete(activationFrame);
          overlay?.classList.add("is-ready");
        });
        activationFrames.add(activationFrame);
      }

      const label = overlay.querySelector<HTMLElement>(
        ".collaboration-carets__overlay-label"
      );
      if (label && label.textContent !== name) {
        label.textContent = name;
      }

      overlay.style.setProperty("--collaboration-caret-color", color);
      overlay.style.height = `${Math.max(markerRect.height, 20)}px`;
      overlay.style.transform = `translate3d(${
        markerRect.left - containerRect.left + overlayContainer.scrollLeft
      }px, ${
        markerRect.top - containerRect.top + overlayContainer.scrollTop
      }px, 0)`;
    }

    for (const [id, overlay] of overlays) {
      if (!activeIds.has(id)) {
        overlay.remove();
        overlays.delete(id);
      }
    }
  };

  const scheduleUpdate = () => {
    if (updateFrame === null) {
      updateFrame = window.requestAnimationFrame(updateOverlays);
    }
  };

  const mutationObserver = new MutationObserver(scheduleUpdate);
  mutationObserver.observe(editorElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  const resizeObserver = new ResizeObserver(scheduleUpdate);
  resizeObserver.observe(editorElement);
  resizeObserver.observe(overlayContainer);

  awareness.on("update", scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);
  scheduleUpdate();

  return () => {
    mutationObserver.disconnect();
    resizeObserver.disconnect();
    awareness.off("update", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);

    if (updateFrame !== null) {
      window.cancelAnimationFrame(updateFrame);
    }
    for (const frame of activationFrames) {
      window.cancelAnimationFrame(frame);
    }
    for (const overlay of overlays.values()) {
      overlay.remove();
    }
    overlays.clear();
  };
}
