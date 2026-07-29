import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { ActiveCollaborator } from "../lib/presence";

interface CollaboratorPresenceProps {
  collaborators: ActiveCollaborator[];
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  editor: "Can edit",
  viewer: "Can view",
};

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function HoverCard({ collaborator }: { collaborator: ActiveCollaborator }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -3 }}
      transition={{ duration: 0.12 }}
      role="tooltip"
      className="absolute top-full right-0 mt-2 z-50 w-max max-w-[200px] rounded-md border border-border-strong bg-bg-elevated px-3 py-2 shadow-lg"
    >
      <p className="flex items-center gap-2 text-ui font-medium text-text-primary">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: collaborator.color }}
        />
        <span className="truncate">{collaborator.name}</span>
      </p>
      <p className="mt-0.5 text-micro text-text-muted">
        {collaborator.role
          ? `${ROLE_LABELS[collaborator.role] ?? collaborator.role} · here now`
          : "Here now"}
      </p>
    </motion.div>
  );
}

export function CollaboratorPresence({ collaborators }: CollaboratorPresenceProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const visible = collaborators.slice(0, 4);
  const extraCount = collaborators.length - visible.length;

  if (collaborators.length === 0) return null;

  const hoveredCollaborator = visible.find(
    (collaborator) => collaborator.userId === hovered
  );

  return (
    <div className="relative flex items-center">
      <div className="flex items-center -space-x-1.5 select-none">
        <AnimatePresence mode="popLayout">
          {visible.map((collaborator) => (
            <motion.div
              key={collaborator.userId}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
              onMouseEnter={() => setHovered(collaborator.userId)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(collaborator.userId)}
              onBlur={() => setHovered(null)}
              tabIndex={0}
              // A viewer cannot change the document, so their marker is drawn
              // as an outline rather than filled.
              className={`relative flex h-6 w-6 items-center justify-center rounded-full border-2 text-micro font-bold shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-transform hover:scale-110 focus-visible:scale-110 ${
                collaborator.role === "viewer"
                  ? "bg-bg-elevated"
                  : "border-bg-primary text-white"
              }`}
              style={
                collaborator.role === "viewer"
                  ? { borderColor: collaborator.color, color: collaborator.color }
                  : { backgroundColor: collaborator.color }
              }
            >
              {initialOf(collaborator.name)}
            </motion.div>
          ))}
        </AnimatePresence>

        {extraCount > 0 && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            title={collaborators
              .slice(4)
              .map((collaborator) => collaborator.name)
              .join(", ")}
            className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-primary bg-bg-tertiary text-micro font-bold text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
          >
            +{extraCount}
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {hoveredCollaborator && <HoverCard collaborator={hoveredCollaborator} />}
      </AnimatePresence>
    </div>
  );
}
