import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Cpu,
  Globe,
  Headphones,
  Palette,
  Pencil,
  Plug,
  ShoppingBag,
  Trash2,
  Volume2,
  ZoomIn,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Device } from "../types";
import { formatDate, formatPrice } from "../lib/format";
import { enumLabel, localeFor, type TranslateFn } from "../lib/i18n";
import type { AppSettings } from "../lib/settings";
import { deriveTubeBadge } from "../lib/tube";
import { summarizePeq } from "../lib/peqCurve";
import { PeqGraph } from "./PeqGraph";
import { MediaImage } from "./MediaImage";
import { TubeBadge } from "./TubeBadge";
import { StarRating } from "./StarRating";
import { DotRating } from "./DotRating";
import { InfoTip } from "./InfoTip";
import { Tip } from "./Tip";
import { Lightbox } from "./Lightbox";
import { btnPrimary } from "../ui";

interface DeviceDetailViewProps {
  device: Device;
  settings: AppSettings;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function DeviceDetailView({
  device,
  settings,
  onBack,
  onEdit,
  onDelete,
}: DeviceDetailViewProps) {
  const { t } = useTranslation();
  const [lightbox, setLightbox] = useState<
    | { kind: "mood" }
    | { kind: "fr" }
    | { kind: "gallery"; index: number }
    | null
  >(null);
  // Without a mood image, the first product image becomes the hero.
  const mainImage = device.mood_image_path ?? device.images[0] ?? null;
  const badge = deriveTubeBadge(device.impedance_ohms, device.driver_type);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-2 text-sm text-tm-gray transition hover:text-tm-fg"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          {t(
            device.category === "headphones" ? "nav.collection" : "nav.devices",
          )}
        </button>
        <div className="flex gap-2">
          <button className={btnPrimary} onClick={onEdit}>
            <Pencil size={14} />
            {t("common.edit")}
          </button>
          <button
            className="flex items-center gap-2 rounded bg-tm-red px-3 py-1.5 text-sm font-medium text-tm-darker transition hover:opacity-90"
            onClick={onDelete}
          >
            <Trash2 size={14} />
            {t("common.delete")}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* Left column: image + identity */}
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-lg border border-tm-dark">
            {mainImage ? (
              <button
                className="group block w-full"
                onClick={() =>
                  setLightbox(
                    device.mood_image_path
                      ? { kind: "mood" }
                      : { kind: "gallery", index: 0 },
                  )
                }
                title={t("detail.zoom")}
              >
                <MediaImage
                  relPath={mainImage}
                  className="aspect-video w-full"
                  placeholderIcon={56}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                  <ZoomIn size={28} className="text-white" />
                </div>
              </button>
            ) : (
              <MediaImage
                relPath={null}
                className="aspect-video w-full"
                placeholderIcon={56}
              />
            )}
            {mainImage && !device.mood_image_path && (
              <p className="border-t border-tm-dark bg-tm-bg px-3 py-1.5 text-xs text-tm-gray">
                {t("detail.productImage")}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-tm-dark bg-tm-bg p-4">
            <h2 className="text-xl font-semibold text-tm-fg">
              {device.brand} {device.model}
            </h2>
            {device.overall_rating != null && (
              <div className="mt-2">
                <StarRating value={device.overall_rating} />
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {device.type && (
                <Tip label={t("fields.type")}>
                  <Chip
                    label={enumLabel(device.type, t)}
                    icon={<Headphones size={12} />}
                  />
                </Tip>
              )}
              {device.device_type && (
                <Tip label={t("fields.type")}>
                  <Chip
                    label={enumLabel(device.device_type, t)}
                    icon={<Cpu size={12} />}
                  />
                </Tip>
              )}
              {device.dac_chip && (
                <Tip label={t("fields.dacChip")}>
                  <Chip label={device.dac_chip} icon={<Cpu size={12} />} />
                </Tip>
              )}
              {device.driver_type && (
                <Tip label={t("fields.driver")}>
                  <Chip
                    label={enumLabel(device.driver_type, t)}
                    icon={<Volume2 size={12} />}
                  />
                </Tip>
              )}
              {device.color && (
                <Tip label={t("fields.color")}>
                  <Chip label={device.color} icon={<Palette size={12} />} />
                </Tip>
              )}
              {device.connector_type && (
                <Tip label={t("fields.connector")}>
                  <Chip
                    label={enumLabel(device.connector_type, t)}
                    icon={<Plug size={12} />}
                  />
                </Tip>
              )}
              {badge && (
                <Tip label={t("fields.tubeAmp")}>
                  <TubeBadge badge={badge} size="sm" tooltip={null} />
                </Tip>
              )}
            </div>
            {(device.manufacturer_url || device.webshop_url) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {device.manufacturer_url && (
                  <UrlButton
                    url={device.manufacturer_url}
                    icon={<Globe size={13} />}
                  />
                )}
                {device.webshop_url && (
                  <UrlButton
                    url={device.webshop_url}
                    icon={<ShoppingBag size={13} />}
                  />
                )}
              </div>
            )}
          </div>

          {/* Product image gallery strip under the identity card */}
          {(device.images.length > 1 ||
            (!!device.mood_image_path && device.images.length >= 1)) && (
            <div className="grid grid-cols-3 gap-2">
              {device.images.map((rel, i) => (
                <button
                  key={rel}
                  className="group relative overflow-hidden rounded border border-tm-dark transition hover:border-tm-accent/60"
                  onClick={() => setLightbox({ kind: "gallery", index: i })}
                  title={t("detail.zoom")}
                >
                  <MediaImage relPath={rel} className="aspect-video w-full" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                    <ZoomIn size={18} className="text-white" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right column: detail sections */}
        <div className="space-y-4">
          <Section title={t("detail.specs")}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {device.category === "headphones" ? (
                <>
                  <SpecItem
                    label={t("fields.impedance")}
                    value={
                      device.impedance_ohms == null
                        ? null
                        : `${device.impedance_ohms} Ω`
                    }
                  />
                  <SpecItem
                    label={t("fields.sensitivity")}
                    value={
                      device.sensitivity_db == null
                        ? null
                        : `${device.sensitivity_db} dB`
                    }
                  />
                  <SpecItem
                    label={t("fields.driveDifficulty")}
                    value={
                      device.drive_difficulty
                        ? enumLabel(device.drive_difficulty, t)
                        : null
                    }
                  />
                  <SpecItem
                    label={t("fields.purchaseDate")}
                    value={formatDate(
                      device.purchase_date,
                      settings.dateFormat,
                    )}
                  />
                  <SpecItem
                    label={t("fields.price")}
                    value={formatPrice(
                      device.price,
                      settings.currency,
                      localeFor(settings.language),
                    )}
                  />
                  <SpecItem
                    label={t("fields.soundSignature")}
                    value={
                      device.sound_signature
                        ? enumLabel(device.sound_signature, t)
                        : null
                    }
                  />
                </>
              ) : (
                <>
                  <SpecItem
                    label={t("fields.dacChip")}
                    value={device.dac_chip}
                  />
                  <SpecItem
                    label={t("fields.supportedFormats")}
                    value={device.supported_formats}
                  />
                  <SpecItem
                    label={t("fields.bluetoothCodecs")}
                    value={
                      device.bluetooth_codecs.length > 0
                        ? device.bluetooth_codecs.join(", ")
                        : null
                    }
                  />
                  <SpecItem
                    label={t("fields.inputs")}
                    value={
                      device.inputs.length > 0 ? device.inputs.join(", ") : null
                    }
                  />
                  <SpecItem
                    label={t("fields.outputs")}
                    value={
                      device.outputs.length > 0
                        ? device.outputs.join(", ")
                        : null
                    }
                  />
                  <SpecItem
                    label={t("fields.outputPower")}
                    value={device.output_power}
                  />
                  <SpecItem
                    label={t("fields.snr")}
                    value={device.snr_db == null ? null : `${device.snr_db} dB`}
                  />
                  <SpecItem label={t("fields.thdN")} value={device.thd_n} />
                  <SpecItem
                    label={t("fields.loadImpedance")}
                    value={
                      device.load_min_ohms == null &&
                      device.load_max_ohms == null
                        ? null
                        : device.load_max_ohms == null
                          ? `≥ ${device.load_min_ohms} Ω`
                          : device.load_min_ohms == null
                            ? `≤ ${device.load_max_ohms} Ω`
                            : `${device.load_min_ohms} – ${device.load_max_ohms} Ω`
                    }
                  />
                  <SpecItem
                    label={t("fields.channels")}
                    value={device.channels}
                  />
                  <SpecItem label={t("fields.hdmi")} value={device.hdmi} />
                  <SpecItem
                    label={t("fields.roomCorrection")}
                    value={device.room_correction}
                  />
                  <SpecItem
                    label={t("fields.purchaseDate")}
                    value={formatDate(
                      device.purchase_date,
                      settings.dateFormat,
                    )}
                  />
                  <SpecItem
                    label={t("fields.price")}
                    value={formatPrice(
                      device.price,
                      settings.currency,
                      localeFor(settings.language),
                    )}
                  />
                </>
              )}
            </div>
          </Section>

          {device.category === "headphones" && (
            <Section title={t("detail.theSound")}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                <SoundField
                  field="soundstage"
                  rating={device.soundstage_rating}
                />
                <SoundField field="imaging" rating={device.imaging_rating} />
                <SoundField
                  field="detailRetrieval"
                  rating={device.detail_retrieval_rating}
                />
                <SoundField field="timbre" rating={device.timbre_rating} />
                <SoundField
                  field="tonalBalance"
                  rating={device.tonal_balance_rating}
                />
              </div>
            </Section>
          )}

          {device.custom_fields.length > 0 && (
            <Section title={t("detail.custom")}>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                {device.custom_fields.map((cf, i) => (
                  <div key={`${cf.key}-${i}`}>
                    <dt className="text-xs text-tm-gray">{cf.key}</dt>
                    <dd className="text-sm text-tm-fg">{cf.value}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          <Section title={t("detail.notes")}>
            {device.listening_notes ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-tm-fg">
                {device.listening_notes}
              </p>
            ) : (
              <EmptyHint text={t("detail.noNotes")} />
            )}
          </Section>

          {device.fr_graph_path && (
            <Section title={t("detail.fr")}>
              <button
                className="group relative block w-full overflow-hidden rounded-lg border border-tm-dark"
                onClick={() => setLightbox({ kind: "fr" })}
                title={t("detail.zoom")}
              >
                <MediaImage
                  relPath={device.fr_graph_path}
                  className="max-h-96 w-full object-contain bg-tm-darker"
                  placeholderIcon={56}
                />
                <div className="absolute right-2 top-2 rounded bg-black/50 p-1.5 opacity-0 transition group-hover:opacity-100">
                  <ZoomIn size={16} className="text-white" />
                </div>
              </button>
            </Section>
          )}

          {device.peq_settings.length > 0 && (
            <Section title={t("detail.peq")}>
              <div className="space-y-2">
                <div className="overflow-hidden rounded-lg border border-tm-dark bg-tm-bg">
                  <PeqGraph bands={device.peq_settings} />
                </div>
                <p className="text-xs text-tm-gray">
                  {t("detail.peqSummary", {
                    summary: summarizePeq(device.peq_settings, t),
                  })}
                </p>
                {device.peq_source && (
                  <p className="text-xs text-tm-gray" title={device.peq_source}>
                    {t("detail.source", { source: device.peq_source })}
                  </p>
                )}
              </div>
            </Section>
          )}
        </div>
      </div>

      {lightbox?.kind === "mood" && (
        <Lightbox
          relPath={device.mood_image_path}
          title={`${device.brand} ${device.model}`}
          onClose={() => setLightbox(null)}
        />
      )}
      {lightbox?.kind === "fr" && (
        <Lightbox
          relPath={device.fr_graph_path}
          title={t("detail.frTitle", {
            name: `${device.brand} ${device.model}`,
          })}
          onClose={() => setLightbox(null)}
        />
      )}
      {lightbox?.kind === "gallery" && (
        <Lightbox
          relPath={device.images[lightbox.index]}
          title={`${device.brand} ${device.model}`}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-tm-dark bg-tm-bg p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-tm-gray">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SpecItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-tm-gray">{label}</p>
      <p className="mt-0.5 text-sm text-tm-fg">{value ?? "—"}</p>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function UrlButton({ url, icon }: { url: string; icon: ReactNode }) {
  return (
    <button
      className="flex items-center gap-1.5 rounded border border-tm-dark bg-tm-darker px-2.5 py-1 text-xs text-tm-cyan transition hover:border-tm-accent hover:text-tm-fg"
      title={url}
      onClick={() => void openUrl(url)}
    >
      {icon}
      {hostOf(url)}
    </button>
  );
}

function Chip({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-tm-dark bg-tm-darker px-2.5 py-0.5 text-xs text-tm-fg">
      {icon && <span className="text-tm-gray">{icon}</span>}
      {label}
    </span>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-tm-gray">{text}</p>;
}

type SoundFieldKey =
  | "soundstage"
  | "imaging"
  | "detailRetrieval"
  | "timbre"
  | "tonalBalance";

function soundLabel(t: TranslateFn, key: SoundFieldKey): string {
  switch (key) {
    case "soundstage":
      return t("fields.soundstage");
    case "imaging":
      return t("fields.imaging");
    case "detailRetrieval":
      return t("fields.detailRetrieval");
    case "timbre":
      return t("fields.timbre");
    case "tonalBalance":
      return t("fields.tonalBalance");
  }
}

function soundInfo(
  t: TranslateFn,
  key: SoundFieldKey,
): { definition: string; traits: string; experience: string } {
  switch (key) {
    case "soundstage":
      return {
        definition: t("soundInfo.soundstage.definition"),
        traits: t("soundInfo.soundstage.traits"),
        experience: t("soundInfo.soundstage.experience"),
      };
    case "imaging":
      return {
        definition: t("soundInfo.imaging.definition"),
        traits: t("soundInfo.imaging.traits"),
        experience: t("soundInfo.imaging.experience"),
      };
    case "detailRetrieval":
      return {
        definition: t("soundInfo.detailRetrieval.definition"),
        traits: t("soundInfo.detailRetrieval.traits"),
        experience: t("soundInfo.detailRetrieval.experience"),
      };
    case "timbre":
      return {
        definition: t("soundInfo.timbre.definition"),
        traits: t("soundInfo.timbre.traits"),
        experience: t("soundInfo.timbre.experience"),
      };
    case "tonalBalance":
      return {
        definition: t("soundInfo.tonalBalance.definition"),
        traits: t("soundInfo.tonalBalance.traits"),
        experience: t("soundInfo.tonalBalance.experience"),
      };
  }
}

/** One rated attribute of The Sound: label + info icon + dot rating. */
function SoundField({
  field,
  rating,
}: {
  field: SoundFieldKey;
  rating: number | null;
}) {
  const { t } = useTranslation();
  const label = soundLabel(t, field);
  const info = soundInfo(t, field);
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs text-tm-gray">
        {label}
        <InfoTip
          label={label}
          definition={info.definition}
          traits={info.traits}
          experience={info.experience}
        />
      </p>
      <div className="mt-1">
        {rating == null ? (
          <span className="text-sm text-tm-gray">—</span>
        ) : (
          <DotRating value={rating} size={10} label={label} />
        )}
      </div>
    </div>
  );
}
