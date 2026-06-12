import { motion, AnimatePresence } from "motion/react";

interface CollaboratorPresenceProps {
  collaborators: { name: string; color: string }[];
}

export function CollaboratorPresence({ collaborators }: CollaboratorPresenceProps) {
  const visibleCollabs = collaborators.slice(0, 4);
  const extraCount = collaborators.length - visibleCollabs.length;

  return (
    <div className="flex items-center -space-x-1.5 select-none">
      <AnimatePresence mode="popLayout">
        {visibleCollabs.map((collab, idx) => {
          const initial = collab.name.charAt(0).toUpperCase() || "?";
          return (
            <motion.div
              key={`${collab.name}-${idx}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
              className="w-6 h-6 rounded-full border border-bg-primary text-white flex items-center justify-center text-[9px] font-bold shadow-[0_1px_2px_rgba(0,0,0,0.08)] cursor-default transition-transform hover:scale-110 relative"
              style={{ backgroundColor: collab.color }}
              title={collab.name}
            >
              {initial}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {extraCount > 0 && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          className="w-6 h-6 rounded-full bg-bg-tertiary border border-border-strong text-text-primary flex items-center justify-center text-[9px] font-bold shadow-[0_1px_2px_rgba(0,0,0,0.05)] cursor-default relative z-10"
          title={`${extraCount} more active user${extraCount > 1 ? "s" : ""}`}
        >
          +{extraCount}
        </motion.div>
      )}
    </div>
  );
}
