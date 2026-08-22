import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Headphones,
  LayoutGrid,
  Pencil,
  Plus,
  Rows3,
  Search,
  Trash2,
} from "lucide-react";
import type { Device } from "../types";
import { DRIVER_TYPES, HEADPHONE_TYPES } from "../types";
import { formatPrice } from "../lib/format";
import { enumLabel, localeFor } from "../lib/i18n";
import type { AppSettings } from "../lib/settings";
import { deriveTubeBadge } from "../lib/tube";
import { MediaImage } from "./MediaImage";
import { StarRating } from "./StarRating";
import { TubeBadge } from "./TubeBadge";
import { Tip } from "./Tip";
import { cls, btnPrimary, btnSecondary } from "../ui";

interface CollectionViewProps {
  devices: Device[];
  settings: AppSettings;
  onOpenDevice: (id: string) => void;
  onAddDevice: () => void;
  onEditDevice: (device: Device) => void;
  onDeleteDevice: (device: Device) => void;
}

type TypeFilter = "all" | (typeof HEADPHONE_TYPES)[number];
type DriverFilter = "all" | (typeof DRIVER_TYPES)[number];
type TubeFilter = "all" | "yes" | "partial" | "no";
type SortKey = "name" | "added" | "modified" | "impedance" | "price";
type ViewMode = "grid" | "list";

const VIEW_MODE_KEY = "audio-vault.viewMode";

function loadViewMode(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === "list"
      ? "list"
      : "grid";
  } catch {
    return "grid";
  }
}

export function CollectionView({
  devices,
  settings,
  onOpenDevice,
  onAddDevice,
  onEditDevice,
  onDeleteDevice,
}: CollectionViewProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [driverFilter, setDriverFilter] = useState<DriverFilter>("all");
  const [tubeFilter, setTubeFilter] = useState<TubeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);

  const hasActiveFilters =
    query.trim() !== "" ||
    typeFilter !== "all" ||
    driverFilter !== "all" ||
    tubeFilter !== "all";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      if (q && !`${d.brand} ${d.model}`.toLowerCase().includes(q)) {
        return false;
      }
      if (typeFilter !== "all" && d.type !== typeFilter) {
        return false;
      }
      if (driverFilter !== "all" && d.driver_type !== driverFilter) {
        return false;
      }
      const badge = deriveTubeBadge(d.impedance_ohms, d.driver_type);
      if (tubeFilter === "yes" && badge !== "Yes") return false;
      if (tubeFilter === "no" && badge !== "No") return false;
      if (
        tubeFilter === "partial" &&
        badge !== "OTL Only" &&
        badge !== "Transformer Only"
      ) {
        return false;
      }
      return true;
    });
  }, [devices, query, typeFilter, driverFilter, tubeFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return (
            dir * `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`)
          );
        case "added":
          return dir * a.created_at.localeCompare(b.created_at);
        case "modified":
          return dir * a.updated_at.localeCompare(b.updated_at);
        case "impedance":
          return dir * ((a.impedance_ohms ?? -1) - (b.impedance_ohms ?? -1));
        case "price":
          return dir * ((a.price ?? -1) - (b.price ?? -1));
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function changeViewMode(m: ViewMode) {
    setViewMode(m);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, m);
    } catch {
      // Non-fatal: the choice just won't persist.
    }
  }

  function clearFilters() {
    setQuery("");
    setTypeFilter("all");
    setDriverFilter("all");
    setTubeFilter("all");
  }

  if (devices.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 py-24 text-center">
        <div className="rounded-full border border-tm-dark bg-tm-darker p-6 text-tm-gray">
          <Headphones size={48} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-tm-fg">
            {t("collection.empty.title")}
          </h2>
          <p className="mt-1 text-sm text-tm-gray">
            {t("collection.empty.hint")}
          </p>
        </div>
        <button className={btnPrimary} onClick={onAddDevice}>
          <Plus size={16} />
          {t("collection.empty.add")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-tm-gray"
          />
          <input
            className="w-full rounded border border-tm-dark bg-tm-darker py-1.5 pl-8 pr-3 text-sm text-tm-fg placeholder:text-tm-gray focus:border-tm-accent focus:outline-none"
            placeholder={t("collection.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <FilterSelect
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as TypeFilter)}
          options={["all", ...HEADPHONE_TYPES]}
          label={(v) =>
            v === "all" ? t("collection.filter.typeAll") : enumLabel(v, t)
          }
        />
        <FilterSelect
          value={driverFilter}
          onChange={(v) => setDriverFilter(v as DriverFilter)}
          options={["all", ...DRIVER_TYPES]}
          label={(v) =>
            v === "all" ? t("collection.filter.driverAll") : enumLabel(v, t)
          }
        />
        <FilterSelect
          value={tubeFilter}
          onChange={(v) => setTubeFilter(v as TubeFilter)}
          options={["all", "yes", "partial", "no"]}
          label={(v) =>
            v === "all"
              ? t("collection.filter.tubeAll")
              : v === "yes"
                ? t("collection.filter.tubeYes")
                : v === "partial"
                  ? t("collection.filter.tubePartial")
                  : t("collection.filter.tubeNo")
          }
        />
        <div className="flex items-center gap-1">
          <select
            className="rounded border border-tm-dark bg-tm-darker px-2.5 py-1.5 text-sm text-tm-fg focus:border-tm-accent focus:outline-none"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label={t("collection.sort.aria")}
          >
            <option value="name">{t("collection.sort.name")}</option>
            <option value="added">{t("collection.sort.added")}</option>
            <option value="modified">{t("collection.sort.modified")}</option>
            <option value="impedance">{t("collection.sort.impedance")}</option>
            <option value="price">{t("collection.sort.price")}</option>
          </select>
          <button
            className={cls(btnSecondary, "px-2")}
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            title={
              sortDir === "asc"
                ? t("collection.sort.asc")
                : t("collection.sort.desc")
            }
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>
        <div className="flex overflow-hidden rounded border border-tm-dark">
          <button
            className={cls(
              "flex items-center px-2.5 py-1.5 transition",
              viewMode === "grid"
                ? "bg-tm-accent/20 text-tm-accent"
                : "text-tm-gray hover:text-tm-fg",
            )}
            onClick={() => changeViewMode("grid")}
            title={t("collection.view.grid")}
            aria-pressed={viewMode === "grid"}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            className={cls(
              "flex items-center px-2.5 py-1.5 transition",
              viewMode === "list"
                ? "bg-tm-accent/20 text-tm-accent"
                : "text-tm-gray hover:text-tm-fg",
            )}
            onClick={() => changeViewMode("list")}
            title={t("collection.view.list")}
            aria-pressed={viewMode === "list"}
          >
            <Rows3 size={15} />
          </button>
        </div>
        {hasActiveFilters && (
          <button
            className="text-xs text-tm-accent hover:underline"
            onClick={clearFilters}
          >
            {t("collection.clearFilters")}
          </button>
        )}
      </div>

      <p className="text-xs text-tm-gray">
        {t("collection.count", {
          shown: sorted.length,
          total: devices.length,
          count: devices.length,
        })}
      </p>

      {/* Grid */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="text-sm text-tm-gray">{t("collection.noMatch")}</p>
          <button className={btnSecondary} onClick={clearFilters}>
            {t("collection.clearFilters")}
          </button>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
          {sorted.map((d) => {
            const badge = deriveTubeBadge(d.impedance_ohms, d.driver_type);
            return (
              <article
                key={d.id}
                className="group cursor-pointer overflow-hidden rounded-lg border border-tm-dark bg-tm-bg transition hover:border-tm-accent/60"
                onClick={() => onOpenDevice(d.id)}
              >
                <div className="relative aspect-video">
                  <MediaImage
                    relPath={d.mood_image_path ?? d.image_path}
                    className="h-full w-full"
                  />
                  {badge && (
                    <div className="absolute right-2 top-2">
                      <Tip label={t(`tube.dot.${badge}`)} side="bottom">
                        <TubeBadge badge={badge} size="sm" dot tooltip={null} />
                      </Tip>
                    </div>
                  )}
                </div>
                <div className="space-y-2 p-3">
                  <div>
                    <h3 className="truncate font-semibold text-tm-fg">
                      {d.brand} {d.model}
                    </h3>
                    <p className="text-xs text-tm-gray">
                      {d.type ? enumLabel(d.type, t) : ""}
                      {d.driver_type ? ` · ${enumLabel(d.driver_type, t)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-tm-gray">
                    {d.impedance_ohms != null && (
                      <span>{d.impedance_ohms} Ω</span>
                    )}
                    {d.sensitivity_db != null && (
                      <span>{d.sensitivity_db} dB</span>
                    )}
                    {d.price != null && (
                      <span>
                        {formatPrice(
                          d.price,
                          settings.currency,
                          localeFor(settings.language),
                        )}
                      </span>
                    )}
                    {d.soundstage_rating != null && (
                      <span>
                        {t("collection.stage", { n: d.soundstage_rating })}
                      </span>
                    )}
                    {d.overall_rating != null && (
                      <StarRating
                        value={d.overall_rating}
                        size={14}
                        showValue={false}
                      />
                    )}
                  </div>
                  <div
                    className="flex items-center gap-2 pt-1 opacity-0 transition group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="flex items-center gap-1 rounded border border-tm-dark px-2 py-1 text-xs text-tm-fg transition hover:bg-tm-dark"
                      onClick={() => onEditDevice(d)}
                    >
                      <Pencil size={12} />
                      {t("common.edit")}
                    </button>
                    <button
                      className="flex items-center gap-1 rounded border border-tm-red/40 px-2 py-1 text-xs text-tm-red transition hover:bg-tm-red/10"
                      onClick={() => onDeleteDevice(d)}
                    >
                      <Trash2 size={12} />
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-tm-dark">
          <table className="w-full min-w-[840px] border-collapse text-sm">
            <thead>
              <tr className="bg-tm-darker text-left text-xs uppercase tracking-wide text-tm-gray">
                <th className="px-3 py-2 font-semibold">{t("fields.brand")}</th>
                <th className="px-3 py-2 font-semibold">{t("fields.model")}</th>
                <th className="px-3 py-2 font-semibold">{t("fields.type")}</th>
                <th className="px-3 py-2 font-semibold">
                  {t("fields.driver")}
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  {t("fields.impedance")}
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  {t("fields.sensitivity")}
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  {t("fields.price")}
                </th>
                <th className="px-3 py-2 font-semibold">
                  {t("fields.rating")}
                </th>
                <th className="px-3 py-2 font-semibold">
                  {t("fields.tubeAmp")}
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  {t("fields.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => {
                const badge = deriveTubeBadge(d.impedance_ohms, d.driver_type);
                return (
                  <tr
                    key={d.id}
                    className="cursor-pointer border-t border-tm-dark transition hover:bg-tm-darker/60"
                    onClick={() => onOpenDevice(d.id)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 shrink-0 overflow-hidden rounded border border-tm-dark bg-tm-darker">
                          <MediaImage
                            relPath={d.image_path}
                            className="h-full w-full"
                          />
                        </div>
                        <span className="font-medium text-tm-fg">
                          {d.brand}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-tm-fg">{d.model}</td>
                    <td className="px-3 py-2 text-tm-gray">
                      {d.type ? enumLabel(d.type, t) : "—"}
                    </td>
                    <td className="px-3 py-2 text-tm-gray">
                      {d.driver_type ? enumLabel(d.driver_type, t) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-tm-gray">
                      {d.impedance_ohms == null ? "—" : `${d.impedance_ohms} Ω`}
                    </td>
                    <td className="px-3 py-2 text-right text-tm-gray">
                      {d.sensitivity_db == null
                        ? "—"
                        : `${d.sensitivity_db} dB`}
                    </td>
                    <td className="px-3 py-2 text-right text-tm-gray">
                      {d.price == null
                        ? "—"
                        : formatPrice(
                            d.price,
                            settings.currency,
                            localeFor(settings.language),
                          )}
                    </td>
                    <td className="px-3 py-2">
                      {d.overall_rating == null ? (
                        <span className="text-tm-gray">—</span>
                      ) : (
                        <StarRating
                          value={d.overall_rating}
                          size={14}
                          showValue={false}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {badge ? (
                        <Tip label={t("fields.tubeAmp")}>
                          <TubeBadge badge={badge} size="sm" tooltip={null} />
                        </Tip>
                      ) : (
                        <span className="text-tm-gray">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="rounded p-1.5 text-tm-gray transition hover:bg-tm-dark hover:text-tm-fg"
                          title={t("common.edit")}
                          aria-label={t("collection.aria.edit", {
                            name: `${d.brand} ${d.model}`,
                          })}
                          onClick={() => onEditDevice(d)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="rounded p-1.5 text-tm-gray transition hover:bg-tm-red/10 hover:text-tm-red"
                          title={t("common.delete")}
                          aria-label={t("collection.aria.delete", {
                            name: `${d.brand} ${d.model}`,
                          })}
                          onClick={() => onDeleteDevice(d)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  label: (value: string) => string;
}

function FilterSelect({ value, onChange, options, label }: FilterSelectProps) {
  return (
    <select
      className="rounded border border-tm-dark bg-tm-darker px-2.5 py-1.5 text-sm text-tm-fg focus:border-tm-accent focus:outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {label(o)}
        </option>
      ))}
    </select>
  );
}
