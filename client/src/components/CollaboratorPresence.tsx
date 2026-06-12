import { motion, AnimatePresence } from "motion/react";

// Placeholder — awareness data will come from Yjs provider
// For now, show a static "you" indicator
export function CollaboratorPresence() {
  return (
    <div className="flex items-center gap-1">
      <AnimatePresence>
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="w-6 h-6 rounded-full bg-bg-tertiary border border-border-strong text-text-primary flex items-center justify-center text-[9px] font-semibold"
          title="You"
        >
          Y
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
