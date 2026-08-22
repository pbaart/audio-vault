import { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Suggested values offered via a datalist while typing. */
  suggestions?: string[];
  placeholder?: string;
  /** Used to build the datalist id; must be unique per page. */
  id: string;
}

/**
 * Chip-style multi-value input: type a value and press Enter (or comma)
 * to add it as a chip, click × or hit Backspace on an empty input to
 * remove. Mirrors the custom-key autocomplete pattern.
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder,
  id,
}: TagInputProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const listId = `${id}-suggestions`;

  function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    // Case-insensitive duplicate guard.
    if (value.some((v) => v.toLowerCase() === tag.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, tag]);
    setDraft("");
  }

  return (
    <div className="rounded border border-tm-dark bg-tm-darker">
      <div className="flex flex-wrap items-center gap-1.5 p-1.5">
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded bg-tm-dark px-2 py-0.5 text-xs text-tm-fg"
          >
            {tag}
            <button
              type="button"
              className="text-tm-gray transition hover:text-tm-red"
              onClick={() => onChange(value.filter((v) => v !== tag))}
              aria-label={t("form.tagRemoveAria", { tag })}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm text-tm-fg placeholder:text-tm-gray focus:outline-none"
          value={draft}
          list={listId}
          placeholder={value.length === 0 ? placeholder : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag(draft);
            } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim() !== "") addTag(draft);
          }}
          autoComplete="off"
        />
      </div>
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}
