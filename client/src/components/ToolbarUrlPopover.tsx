import { useEffect, useId, useRef, useState } from "react";
import { motion } from "motion/react";
import { normalizeUrl } from "../lib/url";

interface ToolbarUrlPopoverProps {
  label: string;
  placeholder: string;
  /** Prefilled when editing something that already has a URL. */
  initialValue?: string;
  submitLabel: string;
  /** Shown as a third action when the current selection already has a URL. */
  onRemove?: () => void;
  removeLabel?: string;
  onSubmit: (url: string) => void;
  onClose: () => void;
}

export function ToolbarUrlPopover({
  label,
  placeholder,
  initialValue = "",
  submitLabel,
  onRemove,
  removeLabel,
  onSubmit,
  onClose,
}: ToolbarUrlPopoverProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputId = `toolbar-url-${useId().replace(/:/g, "")}`;
  const errorId = `${inputId}-error`;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [onClose]);

  const submit = () => {
    const url = normalizeUrl(value);
    if (!url) {
      setError("Enter a web address, for example example.com/page.");
      return;
    }
    onSubmit(url);
    onClose();
  };

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className="absolute top-full left-0 mt-1.5 z-50 w-72 rounded-md border border-border-strong bg-bg-elevated p-3 shadow-lg"
    >
      <label
        htmlFor={inputId}
        className="block text-micro font-semibold uppercase tracking-wider text-text-secondary mb-1.5"
      >
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="url"
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        className="w-full rounded border border-border bg-bg-secondary px-2.5 py-1.5 text-ui text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-accent focus:ring-1 focus:ring-accent-light"
      />

      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-micro text-error">
          {error}
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-end gap-2">
        {onRemove && (
          <button
            type="button"
            onClick={() => {
              onRemove();
              onClose();
            }}
            className="mr-auto rounded px-2 py-1 text-micro font-medium text-text-muted transition-colors hover:bg-error/10 hover:text-error"
          >
            {removeLabel ?? "Remove"}
          </button>
        )}
        <button type="button" onClick={onClose} className="btn-linear text-micro">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          className="btn-linear-primary text-micro"
        >
          {submitLabel}
        </button>
      </div>
    </motion.div>
  );
}
