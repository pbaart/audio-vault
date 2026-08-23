import { useState, type ReactNode } from "react";
import { cls } from "../ui";

interface TipProps {
    label: string;
    children: ReactNode;
    /** Which side of the wrapped element the popup appears on. */
    side?: "top" | "bottom";
    /**
     * Horizontal anchor of the popup. "center" (default) centers it on the
     * wrapped element; "start"/"end" align its start/end edge with the
     * element's, so the popup grows into the card instead of being clipped
     * by an ancestor's overflow-hidden when the element sits at an edge.
     */
    align?: "center" | "start" | "end";
}

/** Hover tooltip showing a short label next to the wrapped badge/pill. */
export function Tip({
    label,
    children,
    side = "top",
    align = "center",
}: TipProps) {
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
                        "absolute z-50 whitespace-nowrap rounded border border-tm-dark bg-tm-bg px-2.5 py-1 text-xs text-tm-fg shadow-lg",
                        side === "top"
                            ? "bottom-full mb-1.5"
                            : "top-full mt-1.5",
                        align === "center" && "left-1/2 -translate-x-1/2",
                        align === "start" && "left-0",
                        align === "end" && "right-0",
                    )}
                >
                    {label}
                </span>
            )}
        </span>
    );
}
