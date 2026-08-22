import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Globe,
  Pencil,
  ShoppingBag,
  Trash2,
  ZoomIn,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Device } from "../types";
import { formatDate, formatPrice } from "../lib/format";
import { enumLabel, localeFor } from "../lib/i18n";
import type { AppSettings } from "../lib/settings";
import { deriveTubeBadge } from "../lib/tube";
import { summarizePeq } from "../lib/peqCurve";
import { PeqGraph } from "./PeqGraph";
import { MediaImage } from "./MediaImage";
import { TubeBadge } from "./TubeBadge";
import { Lightbox } from "./Lightbox";
import { btnPrimary, cls } from "../ui";

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
  const [lightbox, setLightbox] = useState<null | "image" | "mood" | "fr">(null);
  const mainImage = device.mood_image_path ?? device.image_path;
  const mainLightbox: "image" | "mood" = device.mood_image_path ? "mood" : "image";
  const showProductThumb = !!device.image_path && !!device.mood_image_path;
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
          {t("nav.collection")}
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
                onClick={() => setLightbox(mainLightbox)}
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
          </div>
          {showProductThumb && (
            <button
              className="group flex w-full items-center gap-2 rounded-lg border border-tm-dark bg-tm-bg p-2 text-left transition hover:border-tm-accent/60"
              onClick={() => setLightbox("image")}
              title={t("detail.zoom")}
            >
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-tm-dark bg-tm-darker">
                <MediaImage
                  relPath={device.image_path}
                  className="h-full w-full"
                />
              </div>
              <span className="text-xs text-tm-gray">
                {t("detail.productImage")}
              </span>
            </button>
          )}

          <div className="rounded-lg border border-tm-dark bg-tm-bg p-4">
            <p className="text-xs uppercase tracking-wide text-tm-gray">
              {t("detail.device")}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-tm-fg">
              {device.brand} {device.model}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip label={enumLabel(device.type, t)} />
              {device.driver_type && (
                <Chip label={enumLabel(device.driver_type, t)} />
              )}
              {device.color && <Chip label={device.color} />}
              {badge && <TubeBadge badge={badge} size="sm" />}
            </div>
            {device.connector_type && (
              <p className="mt-3 text-sm text-tm-gray">
                {t("detail.connectorLabel")}{" "}
                <span className="text-tm-fg">
                  {enumLabel(device.connector_type, t)}
                </span>
              </p>
            )}
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
        </div>

        {/* Right column: detail sections */}
        <div className="space-y-4">
          <Section title={t("detail.specs")}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
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
                label={t("fields.price")}
                value={formatPrice(
                  device.price,
                  settings.currency,
                  localeFor(settings.language),
                )}
              />
              <SpecItem
                label={t("fields.purchaseDate")}
                value={formatDate(device.purchase_date, settings.dateFormat)}
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
                label={t("fields.soundSignature")}
                value={
                  device.sound_signature
                    ? enumLabel(device.sound_signature, t)
                    : null
                }
              />
              <div>
                <p className="text-xs text-tm-gray">{t("fields.soundstage")}</p>
                <div className="mt-1">
                  <SoundstageDots rating={device.soundstage_rating} />
                </div>
              </div>
            </div>
          </Section>

          <Section title={t("detail.notes")}>
            {device.listening_notes ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-tm-fg">
                {device.listening_notes}
              </p>
            ) : (
              <EmptyHint text={t("detail.noNotes")} />
            )}
          </Section>

          <Section title={t("detail.fr")}>
            {device.fr_graph_path ? (
              <button
                className="group relative block w-full overflow-hidden rounded-lg border border-tm-dark"
                onClick={() => setLightbox("fr")}
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
            ) : (
              <EmptyHint text={t("detail.noFr")} />
            )}
          </Section>

          <Section title={t("detail.peq")}>
            {device.peq_settings.length > 0 ? (
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
            ) : (
              <EmptyHint text={t("detail.noPeq")} />
            )}
          </Section>

          <Section title={t("detail.custom")}>
            {device.custom_fields.length > 0 ? (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                {device.custom_fields.map((cf, i) => (
                  <div key={`${cf.key}-${i}`}>
                    <dt className="text-xs text-tm-gray">{cf.key}</dt>
                    <dd className="text-sm text-tm-fg">{cf.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <EmptyHint text={t("detail.noCustom")} />
            )}
          </Section>
        </div>
      </div>

      {lightbox === "image" && (
        <Lightbox
          relPath={device.image_path}
          title={`${device.brand} ${device.model}`}
          onClose={() => setLightbox(null)}
        />
      )}
      {lightbox === "mood" && (
        <Lightbox
          relPath={device.mood_image_path}
          title={`${device.brand} ${device.model}`}
          onClose={() => setLightbox(null)}
        />
      )}
      {lightbox === "fr" && (
        <Lightbox
          relPath={device.fr_graph_path}
          title={t("detail.frTitle", {
            name: `${device.brand} ${device.model}`,
          })}
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

function Chip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-tm-dark bg-tm-darker px-2.5 py-0.5 text-xs text-tm-fg">
      {label}
    </span>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-tm-gray">{text}</p>;
}

function SoundstageDots({ rating }: { rating: number | null }) {
  if (rating == null) {
    return <span className="text-sm text-tm-gray">—</span>;
  }
  return (
    <span className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cls(
            "h-2.5 w-2.5 rounded-full",
            i <= rating ? "bg-tm-accent" : "bg-tm-dark",
          )}
        />
      ))}
      <span className="ml-1 text-xs text-tm-gray">{rating}/5</span>
    </span>
  );
}
