import { useState, type ReactNode } from "react";
import { cls } from "../ui";

interface TipProps {
        label: string;
        children: ReactNode;
        /** Which side of the wrapped element the popup appears on. */
        side?: "top" | "bottom";
}

/** Hover tooltip showing a short label next to the wrapped badge/pill. */
export function Tip({ label, children, side = "top" }: TipProps) {
        const [open, setOpen] = useState(false);
        return (
                <span
                        className="relative inline-flex"
                        onMouseEnter={() => setOpen(true)}
                        onMouseLeave={() => setOpen(false)}
                >
                        {children}
                        {open && (
                                <span
                                        role="tooltip"
                                        className={cls(
                                                "absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded border border-tm-dark bg-tm-bg px-2.5 py-1 text-xs text-tm-fg shadow-lg",
                                                side === "top"
                                                        ? "bottom-full mb-1.5"
                                                        : "top-full mt-1.5",
                                        )}
                                >
                                        {label}
                                </span>
                        )}
                </span>
        );
}
