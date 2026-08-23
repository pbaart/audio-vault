import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { Device, DeviceCategory } from "../types";
import { formatDate, formatPrice } from "../lib/format";
import { enumLabel, localeFor } from "../lib/i18n";
import type { AppSettings } from "../lib/settings";
import { MediaImage } from "./MediaImage";
import { IMG_SIZE_CARD } from "../lib/media";
import { StarRating } from "./StarRating";
import { DotRating } from "./DotRating";

interface CompareViewProps {
  /** Category of the items being compared side by side (2–4). */
  category: DeviceCategory;
  devices: Device[];
  settings: AppSettings;
  onBack: () => void;
}

/** One comparison row: label + per-device value renderer. */
type Row = { label: string; render: (d: Device) => ReactNode };

/** Load-impedance range, formatted like the detail view. */
function loadImpedance(d: Device): string | null {
  if (d.load_min_ohms == null && d.load_max_ohms == null) return null;
  if (d.load_max_ohms == null) return `≥ ${d.load_min_ohms} Ω`;
  if (d.load_min_ohms == null) return `≤ ${d.load_max_ohms} Ω`;
  return `${d.load_min_ohms} – ${d.load_max_ohms} Ω`;
}

/**
 * Side-by-side comparison of up to four items of one category: product
 * image and name on top, then identity, technical specs, rating, The
 * Sound (headphones only), notes and custom fields. PEQ and frequency
 * response are intentionally not compared; missing values show as N/A.
 */
export function CompareView({
  category,
  devices,
  settings,
  onBack,
}: CompareViewProps) {
  const { t } = useTranslation();
  const na = <span className="text-tm-gray">{t("common.na")}</span>;
  const isHp = category === "headphones";

  const enumRow = (
    labelKey: string,
    get: (d: Device) => string | null,
  ): Row => ({
    label: t(labelKey),
    render: (d) => {
      const v = get(d);
      return v ? enumLabel(v, t) : na;
    },
  });

  const textRow = (
    labelKey: string,
    get: (d: Device) => string | null,
  ): Row => ({
    label: t(labelKey),
    render: (d) => get(d) || na,
  });

  const listRow = (labelKey: string, get: (d: Device) => string[]): Row => ({
    label: t(labelKey),
    render: (d) => {
      const v = get(d);
      return v.length > 0 ? v.join(", ") : na;
    },
  });

  const hpSpecRows: Row[] = [
    enumRow("fields.driver", (d) => d.driver_type),
    textRow("fields.color", (d) => d.color),
    enumRow("fields.connector", (d) => d.connector_type),
    enumRow("fields.status", (d) => d.ownership_status),
    {
      label: t("fields.impedance"),
      render: (d) => (d.impedance_ohms == null ? na : `${d.impedance_ohms} Ω`),
    },
    {
      label: t("fields.sensitivity"),
      render: (d) => (d.sensitivity_db == null ? na : `${d.sensitivity_db} dB`),
    },
    enumRow("fields.driveDifficulty", (d) => d.drive_difficulty),
    enumRow("fields.soundSignature", (d) => d.sound_signature),
  ];

  const devSpecRows: Row[] = [
    textRow("fields.dacChip", (d) => d.dac_chip),
    textRow("fields.supportedFormats", (d) => d.supported_formats),
    listRow("fields.bluetoothCodecs", (d) => d.bluetooth_codecs),
    listRow("fields.inputs", (d) => d.inputs),
    listRow("fields.outputs", (d) => d.outputs),
    textRow("fields.outputPower", (d) => d.output_power),
    {
      label: t("fields.snr"),
      render: (d) => (d.snr_db == null ? na : `${d.snr_db} dB`),
    },
    textRow("fields.thdN", (d) => d.thd_n),
    {
      label: t("fields.loadImpedance"),
      render: (d) => loadImpedance(d) ?? na,
    },
    textRow("fields.channels", (d) => d.channels),
    textRow("fields.hdmi", (d) => d.hdmi),
    textRow("fields.roomCorrection", (d) => d.room_correction),
    textRow("fields.color", (d) => d.color),
    enumRow("fields.status", (d) => d.ownership_status),
  ];

  const techRows: Row[] = [
    enumRow("fields.type", (d) => (isHp ? d.type : d.device_type)),
    ...(isHp ? hpSpecRows : devSpecRows),
    {
      label: t("fields.price"),
      render: (d) =>
        d.price == null
          ? na
          : formatPrice(
              d.price,
              settings.currency,
              localeFor(settings.language),
            ),
    },
    {
      label: t("fields.purchaseDate"),
      render: (d) => formatDate(d.purchase_date, settings.dateFormat) ?? na,
    },
    {
      label: t("fields.rating"),
      render: (d) =>
        d.overall_rating == null ? (
          na
        ) : (
          <StarRating value={d.overall_rating} size={14} showValue={false} />
        ),
    },
  ];

  const soundRow = (
    fieldKey: string,
    get: (d: Device) => number | null,
  ): Row => ({
    label: t(fieldKey),
    render: (d) => {
      const v = get(d);
      return v == null ? (
        na
      ) : (
        <DotRating value={v} size={10} showValue={false} label={t(fieldKey)} />
      );
    },
  });

  const soundRows: Row[] = [
    soundRow("fields.soundstage", (d) => d.soundstage_rating),
    soundRow("fields.imaging", (d) => d.imaging_rating),
    soundRow("fields.detailRetrieval", (d) => d.detail_retrieval_rating),
    soundRow("fields.timbre", (d) => d.timbre_rating),
    soundRow("fields.tonalBalance", (d) => d.tonal_balance_rating),
  ];

  // Custom field keys are free-form and differ per item — compare the
  // union of keys, N/A where an item doesn't have one.
  const customKeys: string[] = [];
  for (const d of devices) {
    for (const cf of d.custom_fields) {
      if (!customKeys.includes(cf.key)) customKeys.push(cf.key);
    }
  }
  const customRows: Row[] = customKeys.map((k) => ({
    label: k,
    render: (d) => d.custom_fields.find((c) => c.key === k)?.value || na,
  }));

  const notesRow: Row = {
    label: t("detail.notes"),
    render: (d) =>
      d.listening_notes ? (
        <span className="whitespace-pre-wrap">{d.listening_notes}</span>
      ) : (
        na
      ),
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-2 text-sm text-tm-gray transition hover:text-tm-fg"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          {t(isHp ? "nav.collection" : "nav.devices")}
        </button>
        <h2 className="text-lg font-semibold text-tm-fg">
          {t(isHp ? "compare.titleHeadphones" : "compare.titleDevices")}
        </h2>
      </div>

      <div className="overflow-x-auto rounded-lg border border-tm-dark">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="bg-tm-darker">
              <th className="w-44 px-3 py-3" />
              {devices.map((d) => (
                <th
                  key={d.id}
                  className="min-w-44 px-3 py-3 text-left align-top font-normal"
                >
                  <div className="w-44 overflow-hidden rounded border border-tm-dark bg-tm-bg">
                    <MediaImage
                      relPath={d.mood_image_path ?? d.images[0]}
                      className="aspect-video w-full"
                      placeholderIcon={40}
                      maxDim={IMG_SIZE_CARD}
                    />
                  </div>
                  <p className="mt-2 truncate font-semibold text-tm-fg">
                    {d.brand} {d.model}
                  </p>
                  <p className="truncate text-xs text-tm-gray">
                    {isHp
                      ? [
                          d.type && enumLabel(d.type, t),
                          d.driver_type && enumLabel(d.driver_type, t),
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : d.device_type
                        ? enumLabel(d.device_type, t)
                        : ""}
                  </p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SectionRow
              title={t("detail.specs")}
              colSpan={devices.length + 1}
            />
            {techRows.map((row) => (
              <DataRow key={row.label} row={row} devices={devices} />
            ))}
            {isHp && (
              <>
                <SectionRow
                  title={t("detail.theSound")}
                  colSpan={devices.length + 1}
                />
                {soundRows.map((row) => (
                  <DataRow key={row.label} row={row} devices={devices} />
                ))}
              </>
            )}
            <DataRow row={notesRow} devices={devices} />
            {customRows.length > 0 && (
              <>
                <SectionRow
                  title={t("detail.custom")}
                  colSpan={devices.length + 1}
                />
                {customRows.map((row) => (
                  <DataRow key={row.label} row={row} devices={devices} />
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Full-width section header row inside the comparison table. */
function SectionRow({ title, colSpan }: { title: string; colSpan: number }) {
  return (
    <tr className="border-t border-tm-dark bg-tm-darker/60">
      <td
        colSpan={colSpan}
        className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-tm-gray"
      >
        {title}
      </td>
    </tr>
  );
}

/** One data row: label column + one cell per compared item. */
function DataRow({ row, devices }: { row: Row; devices: Device[] }) {
  return (
    <tr className="border-t border-tm-dark align-top">
      <td className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-tm-gray">
        {row.label}
      </td>
      {devices.map((d) => (
        <td key={d.id} className="px-3 py-2 text-tm-fg">
          {row.render(d)}
        </td>
      ))}
    </tr>
  );
}
