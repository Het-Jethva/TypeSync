import type { SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Classes for the wrapper, which is what the surrounding layout sees. */
  wrapperClassName?: string;
}

/**
 * A select with the browser's own arrow suppressed and one drawn in its place,
 * so the indicator follows the text colour and the theme instead of being
 * painted by the platform, and has room to sit in.
 */
export function Select({
  className = "",
  wrapperClassName = "",
  children,
  ...props
}: SelectProps) {
  return (
    <div className={`relative inline-flex items-center ${wrapperClassName}`}>
      <select
        {...props}
        className={`w-full appearance-none rounded border border-border bg-bg-primary py-1.5 pl-2.5 pr-7 text-text-primary transition-[background-color,border-color,color,box-shadow] focus:border-border-accent focus:outline-none focus:ring-1 focus:ring-accent-light cursor-pointer ${className}`}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        className="pointer-events-none absolute right-2 h-3 w-3 text-text-muted"
      >
        <path
          d="M6 9l6 6 6-6"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
