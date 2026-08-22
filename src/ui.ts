/** Join class names, skipping falsy values. */
export function cls(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

export const inputCls =
  "w-full rounded border border-tm-dark bg-tm-darker px-2.5 py-1.5 text-sm text-tm-fg placeholder:text-tm-gray focus:border-tm-accent focus:outline-none";

export const selectCls =
  "rounded border border-tm-dark bg-tm-darker px-2.5 py-1.5 text-sm text-tm-fg focus:border-tm-accent focus:outline-none";

export const btnPrimary =
  "flex items-center gap-2 rounded bg-tm-accent px-3 py-1.5 text-sm font-medium text-tm-darker transition hover:bg-tm-blue";

export const btnSecondary =
  "flex items-center gap-2 rounded border border-tm-dark bg-transparent px-3 py-1.5 text-sm text-tm-fg transition hover:bg-tm-dark";

export const btnDanger =
  "flex items-center gap-2 rounded bg-tm-red px-3 py-1.5 text-sm font-medium text-tm-darker transition hover:opacity-90";
