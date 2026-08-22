import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  FolderOpen,
  Plus,
  Trash2,
  AudioLines,
  FileUp,
} from "lucide-react";
import type {
  ConnectorType,
  CustomField,
  Device,
  DeviceCategory,
  DeviceType,
  DriverType,
  DriveDifficulty,
  HeadphoneType,
  PeqBand,
  PeqType,
  SoundSignature,
  TubeBadgeValue,
} from "../types";
import {
  CONNECTOR_TYPES,
  DEVICE_TYPES,
  DRIVER_TYPES,
  DRIVE_DIFFICULTIES,
  HEADPHONE_TYPES,
  SOUND_SIGNATURES,
  TUBE_BADGES,
} from "../types";
import { deriveTubeBadge, describeTubeRule, tubeBadgeLabel } from "../lib/tube";
import {
  enumLabel,
  localizeNote,
  localeFor,
  type TranslateFn,
} from "../lib/i18n";
import {
  getDistinctBrands,
  getDistinctColors,
  getDistinctCustomKeys,
  saveDevice,
} from "../lib/db";
import { pickImageFile, removeMediaFile } from "../lib/media";
import { toPeqDraft } from "../lib/parseFiioEq";
import { parsePeqFile } from "../lib/peqImport";
import {
  fetchOpraPresets,
  opraSourceLabel,
  toPeqBands,
  type OpraFetchResult,
  type OpraProfile,
} from "../lib/opra";
import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { formatDate, parseDateToISO, currencySymbol } from "../lib/format";
import type { AppSettings, DateFormat } from "../lib/settings";
import {
  downloadImage,
  fetchSpecs,
  saveMediaBytes,
  type FetchedSpecs,
} from "../lib/fetchSpecs";
import { renderFrPng } from "../lib/renderFr";
import { FrPreview } from "./FrPreview";
import { DateCalendar } from "./DateCalendar";
import { MediaImage } from "./MediaImage";
import { Modal } from "./Modal";
import { StarRating } from "./StarRating";
import { DotRating } from "./DotRating";
import { TubeBadge } from "./TubeBadge";
import { Tip } from "./Tip";
import { TagInput } from "./TagInput";
import {
  btnDanger,
  btnPrimary,
  btnSecondary,
  cls,
  inputCls,
  selectCls,
} from "../ui";

interface PeqDraft {
  type: PeqType;
  freq: string;
  gain: string;
  q: string;
}

/** A parsed PEQ file import, awaiting replace confirmation. */
interface PeqImportPending {
  bands: PeqDraft[];
  notes: string[];
  fileName: string;
  source: string | null;
}

/** OPRA lookup state (auto-checked on brand/model changes). */
type OpraCheck =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "done"; result: OpraFetchResult };

interface CustomDraft {
  key: string;
  value: string;
}

interface FormState {
  brand: string;
  model: string;
  type: HeadphoneType | "";
  /** Devices category: type within the devices category. */
  device_type: DeviceType | "";
  color: string;
  manufacturer_url: string;
  webshop_url: string;
  image_path: string | null;
  mood_image_path: string | null;
  /** Devices category: product image gallery (first = cover). */
  images: string[];
  price: string;
  purchase_date: string;
  driver_type: DriverType | "";
  impedance_ohms: string;
  sensitivity_db: string;
  connector_type: ConnectorType | "";
  tube_amp_suitable: TubeBadgeValue | "";
  drive_difficulty: DriveDifficulty | "";
  sound_signature: SoundSignature | "";
  soundstage_rating: string;
  imaging_rating: string;
  detail_retrieval_rating: string;
  timbre_rating: string;
  tonal_balance_rating: string;
  overall_rating: string;
  /** Devices-category specs ("" = unset; empty arrays = none). */
  dac_chip: string;
  supported_formats: string;
  bluetooth_codecs: string[];
  inputs: string[];
  outputs: string[];
  output_power: string;
  snr_db: string;
  thd_n: string;
  load_min_ohms: string;
  load_max_ohms: string;
  channels: string;
  hdmi: string;
  room_correction: string;
  listening_notes: string;
  fr_graph_path: string | null;
  peq: PeqDraft[];
  /** Provenance of the PEQ bands ("" = none); stored as null when empty. */
  peq_source: string;
  custom: CustomDraft[];
}

/** Port suggestions for the devices-category tag inputs. */
const INPUT_SUGGESTIONS = [
  "USB-C",
  "USB-A",
  "Optical (TOSLINK)",
  "Coaxial",
  "RCA",
  "3.5mm",
  "XLR",
  "Bluetooth",
  "HDMI",
];
const OUTPUT_SUGGESTIONS = [
  "3.5mm",
  "4.4mm Pentaconn",
  "RCA",
  "XLR",
  "Sub out",
  "Speaker L/R",
  "HDMI eARC",
  "Pre-out",
];
const CODEC_SUGGESTIONS = [
  "SBC",
  "AAC",
  "aptX",
  "aptX HD",
  "aptX Adaptive",
  "aptX Lossless",
  "LC3",
  "LDAC",
];

/** Which spec groups apply to a device type ("" = not chosen yet). */
const NO_DAC: ReadonlySet<string> = new Set([
  "AMP",
  "BT Amp",
  "Tube Amp",
  "Power Amp",
  "Preamp",
  "Phono Stage",
  "Turntable",
]);

const NO_AMP: ReadonlySet<string> = new Set([
  "DAC",
  "Dongle DAC",
  "Preamp",
  "Streamer",
  "Phono Stage",
  "Turntable",
]);

function showDac(dt: string): boolean {
  return dt === "" || !NO_DAC.has(dt);
}

function showAmp(dt: string): boolean {
  return dt === "" || !NO_AMP.has(dt);
}

function fromDevice(device: Device | null, dateFormat: DateFormat): FormState {
  return {
    brand: device?.brand ?? "",
    model: device?.model ?? "",
    type: device?.type ?? "",
    device_type: device?.device_type ?? "",
    color: device?.color ?? "",
    manufacturer_url: device?.manufacturer_url ?? "",
    webshop_url: device?.webshop_url ?? "",
    image_path: device?.image_path ?? null,
    mood_image_path: device?.mood_image_path ?? null,
    images: device?.images ?? [],
    price: device?.price == null ? "" : String(device.price),
    purchase_date: formatDate(device?.purchase_date ?? null, dateFormat) ?? "",
    driver_type: device?.driver_type ?? "",
    impedance_ohms:
      device?.impedance_ohms == null ? "" : String(device.impedance_ohms),
    sensitivity_db:
      device?.sensitivity_db == null ? "" : String(device.sensitivity_db),
    connector_type: device?.connector_type ?? "",
    tube_amp_suitable: device?.tube_amp_suitable ?? "",
    drive_difficulty: device?.drive_difficulty ?? "",
    sound_signature: device?.sound_signature ?? "",
    soundstage_rating:
      device?.soundstage_rating == null ? "" : String(device.soundstage_rating),
    imaging_rating:
      device?.imaging_rating == null ? "" : String(device.imaging_rating),
    detail_retrieval_rating:
      device?.detail_retrieval_rating == null
        ? ""
        : String(device.detail_retrieval_rating),
    timbre_rating:
      device?.timbre_rating == null ? "" : String(device.timbre_rating),
    tonal_balance_rating:
      device?.tonal_balance_rating == null
        ? ""
        : String(device.tonal_balance_rating),
    overall_rating:
      device?.overall_rating == null ? "" : String(device.overall_rating),
    listening_notes: device?.listening_notes ?? "",
    fr_graph_path: device?.fr_graph_path ?? null,
    peq: (device?.peq_settings ?? []).map((b) => ({
      type: b.type,
      freq: String(b.freq_hz),
      gain: String(b.gain_db),
      q: String(b.q),
    })),
    peq_source: device?.peq_source ?? "",
    custom: (device?.custom_fields ?? []).map((c) => ({
      key: c.key,
      value: c.value,
    })),
    dac_chip: device?.dac_chip ?? "",
    supported_formats: device?.supported_formats ?? "",
    bluetooth_codecs: device?.bluetooth_codecs ?? [],
    inputs: device?.inputs ?? [],
    outputs: device?.outputs ?? [],
    output_power: device?.output_power ?? "",
    snr_db: device?.snr_db == null ? "" : String(device.snr_db),
    thd_n: device?.thd_n ?? "",
    load_min_ohms:
      device?.load_min_ohms == null ? "" : String(device.load_min_ohms),
    load_max_ohms:
      device?.load_max_ohms == null ? "" : String(device.load_max_ohms),
    channels: device?.channels ?? "",
    hdmi: device?.hdmi ?? "",
    room_correction: device?.room_correction ?? "",
  };
}

function parseOptInt(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

function parseOptFloat(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a user-entered URL for storage; null when empty or invalid. */
function normalizeUrl(raw: string): string | null {
  let v = raw.trim();
  if (v === "") return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function validate(
  f: FormState,
  t: TranslateFn,
  category: DeviceCategory,
): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.brand.trim()) e.brand = t("form.validation.brandRequired");
  if (!f.model.trim()) e.model = t("form.validation.modelRequired");
  if (category === "headphones") {
    if (!f.type) e.type = t("form.validation.typeRequired");
  } else if (!f.device_type) {
    e.device_type = t("form.validation.typeRequired");
  }
  if (f.price !== "" && !Number.isFinite(Number(f.price)))
    e.price = t("form.validation.priceNumber");
  if (
    f.impedance_ohms !== "" &&
    !(
      Number.isInteger(Number(f.impedance_ohms)) &&
      Number(f.impedance_ohms) >= 0
    )
  )
    e.impedance_ohms = t("form.validation.impedanceInt");
  if (f.sensitivity_db !== "" && !Number.isFinite(Number(f.sensitivity_db)))
    e.sensitivity_db = t("form.validation.sensitivityNumber");
  if (f.snr_db !== "" && !Number.isFinite(Number(f.snr_db)))
    e.snr_db = t("form.validation.snrNumber");
  for (const key of ["load_min_ohms", "load_max_ohms"] as const) {
    if (
      f[key] !== "" &&
      !(Number.isInteger(Number(f[key])) && Number(f[key]) >= 0)
    )
      e[key] = t("form.validation.wholeNumber");
  }
  const checkHalfRating = (v: string, key: string) => {
    if (
      v !== "" &&
      !(
        Number.isFinite(Number(v)) &&
        Number(v) >= 0.5 &&
        Number(v) <= 5 &&
        Number(v) % 0.5 === 0
      )
    ) {
      e[key] = t("form.validation.rangeHalf1to5");
    }
  };
  checkHalfRating(f.soundstage_rating, "soundstage_rating");
  if (
    f.overall_rating !== "" &&
    !(
      Number.isFinite(Number(f.overall_rating)) &&
      Number(f.overall_rating) >= 0.5 &&
      Number(f.overall_rating) <= 5 &&
      Number(f.overall_rating) % 0.5 === 0
    )
  )
    e.overall_rating = t("form.validation.ratingRange");
  checkHalfRating(f.imaging_rating, "imaging_rating");
  checkHalfRating(f.detail_retrieval_rating, "detail_retrieval_rating");
  checkHalfRating(f.timbre_rating, "timbre_rating");
  checkHalfRating(f.tonal_balance_rating, "tonal_balance_rating");
  if (
    f.manufacturer_url.trim() !== "" &&
    normalizeUrl(f.manufacturer_url) == null
  )
    e.manufacturer_url = t("form.validation.urlInvalid");
  if (f.webshop_url.trim() !== "" && normalizeUrl(f.webshop_url) == null)
    e.webshop_url = t("form.validation.urlInvalid");

  f.peq.forEach((b, i) => {
    const freq = Number(b.freq);
    if (b.freq.trim() === "") {
      e[`peq_${i}_freq`] = t("form.validation.peqFreqRequired");
    } else if (!Number.isFinite(freq))
      e[`peq_${i}_freq`] = t("form.validation.peqNumber");
    else if (freq <= 0)
      e[`peq_${i}_freq`] = t("form.validation.peqFreqPositive");
    if (b.gain.trim() !== "" && !Number.isFinite(Number(b.gain)))
      e[`peq_${i}_gain`] = t("form.validation.peqNumber");
    if (b.type === "PK" || b.type === "LSC") {
      if (b.q.trim() === "")
        e[`peq_${i}_q`] = t("form.validation.peqQRequired");
      else if (!Number.isFinite(Number(b.q)) || Number(b.q) <= 0)
        e[`peq_${i}_q`] = t("form.validation.peqQPositive");
    } else if (
      b.q.trim() !== "" &&
      (!Number.isFinite(Number(b.q)) || Number(b.q) <= 0)
    ) {
      e[`peq_${i}_q`] = t("form.validation.peqQPositive");
    }
  });

  return e;
}

interface DeviceFormDialogProps {
  device: Device | null;
  /** Category for new devices; editing uses the device's own category. */
  category: DeviceCategory;
  settings: AppSettings;
  onClose: () => void;
  onSaved: (device: Device) => void;
}

type FetchState =
  | { status: "idle" }
  | { status: "fetching" }
  | { status: "done"; result: FetchedSpecs; applied: boolean };

/** A fetched FR curve awaiting the user's "use" action. */
interface PendingFr {
  curve: number[][];
  source: string;
}

/** Add/Edit modal. Numeric inputs are kept as strings and parsed on save. */
export function DeviceFormDialog({
  device,
  category,
  settings,
  onClose,
  onSaved,
}: DeviceFormDialogProps) {
  const { t } = useTranslation();
  /** Effective category: the device's own when editing, else the page's. */
  const cat: DeviceCategory = device?.category ?? category;
  const [form, setForm] = useState<FormState>(() =>
    fromDevice(device, settings.dateFormat),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageDownloading, setImageDownloading] = useState(false);
  const [moodImageUrl, setMoodImageUrl] = useState("");
  const [moodImageDownloading, setMoodImageDownloading] = useState(false);
  /** Devices gallery: URL currently being downloaded into media/. */
  const [galleryUrl, setGalleryUrl] = useState("");
  const [galleryDownloading, setGalleryDownloading] = useState(false);
  /** Media files superseded in this session — deleted only on successful save. */
  const [replacedMedia, setReplacedMedia] = useState<string[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [pendingFr, setPendingFr] = useState<PendingFr | null>(null);
  /** Distinct brands from the database — suggestions for the brand input. */
  const [brands, setBrands] = useState<string[]>([]);
  /** Distinct colors from the database — suggestions for the color input. */
  const [colors, setColors] = useState<string[]>([]);
  /** Distinct custom-field keys from the database — suggestions for the custom key input. */
  const [customKeys, setCustomKeys] = useState<string[]>([]);
  /** OPRA lookup state for the current brand/model. */
  const [opraCheck, setOpraCheck] = useState<OpraCheck>({ status: "idle" });
  /** OPRA profile id currently applied to the form (shown as applied). */
  const [appliedProfileId, setAppliedProfileId] = useState<string | null>(null);
  /** Non-fatal note about the applied/imported PEQ (e.g. overall gain). */
  const [peqNote, setPeqNote] = useState<string | null>(null);
  /** Parsed PEQ file import awaiting replace confirmation. */
  const [importPending, setImportPending] = useState<PeqImportPending | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);

  // The dialog is mounted fresh each time it opens, so this runs per open
  // and always reflects the current database contents.
  useEffect(() => {
    getDistinctBrands()
      .then(setBrands)
      .catch(() => undefined);
    getDistinctColors()
      .then(setColors)
      .catch(() => undefined);
    getDistinctCustomKeys()
      .then(setCustomKeys)
      .catch(() => undefined);
  }, []);

  // OPRA auto-check: debounced on brand/model. Best-effort and cache-backed
  // in Rust — the first lookup may download the ~13 MB database, afterwards
  // it is a local lookup. Failures land in `note`, never as a blocker.
  useEffect(() => {
    // OPRA profiles only exist for headphones.
    if (cat !== "headphones") {
      setOpraCheck({ status: "idle" });
      return;
    }
    const brand = form.brand.trim();
    const model = form.model.trim();
    if (!brand || !model) {
      setOpraCheck({ status: "idle" });
      return;
    }
    let cancelled = false;
    setOpraCheck((s) => (s.status === "checking" ? s : { status: "checking" }));
    const t = setTimeout(() => {
      void (async () => {
        try {
          const result = await fetchOpraPresets(brand, model);
          if (!cancelled) setOpraCheck({ status: "done", result });
        } catch (err) {
          if (!cancelled) {
            setOpraCheck({
              status: "done",
              result: { candidates: [], note: String(err) },
            });
          }
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [form.brand, form.model, cat]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const previewBadge = useMemo(
    () =>
      deriveTubeBadge(
        parseOptInt(form.impedance_ohms),
        form.driver_type || null,
      ),
    [form.impedance_ohms, form.driver_type],
  );

  async function handlePickImage(kind: "image" | "mood" | "fr") {
    setPickError(null);
    try {
      const rel = await pickImageFile();
      if (!rel) return;
      if (kind === "image") {
        if (form.image_path && form.image_path !== rel) {
          setReplacedMedia((r) => [...r, form.image_path!]);
        }
        set("image_path", rel);
      } else if (kind === "mood") {
        if (form.mood_image_path && form.mood_image_path !== rel) {
          setReplacedMedia((r) => [...r, form.mood_image_path!]);
        }
        set("mood_image_path", rel);
      } else {
        if (form.fr_graph_path && form.fr_graph_path !== rel) {
          setReplacedMedia((r) => [...r, form.fr_graph_path!]);
        }
        set("fr_graph_path", rel);
      }
    } catch (err) {
      setPickError(String(err));
    }
  }

  /** Download an image from a pasted URL into the media folder. */
  async function handleDownloadImage(kind: "image" | "mood") {
    const url = (kind === "image" ? imageUrl : moodImageUrl).trim();
    const downloading =
      kind === "image" ? imageDownloading : moodImageDownloading;
    if (!url || downloading) return;
    setPickError(null);
    const setDownloading =
      kind === "image" ? setImageDownloading : setMoodImageDownloading;
    const clearUrl = kind === "image" ? setImageUrl : setMoodImageUrl;
    setDownloading(true);
    try {
      const name = `${form.brand} ${form.model}`.trim() || "image";
      const rel = await downloadImage(url, name);
      if (kind === "image") {
        if (form.image_path && form.image_path !== rel) {
          setReplacedMedia((r) => [...r, form.image_path!]);
        }
        set("image_path", rel);
      } else {
        if (form.mood_image_path && form.mood_image_path !== rel) {
          setReplacedMedia((r) => [...r, form.mood_image_path!]);
        }
        set("mood_image_path", rel);
      }
      clearUrl("");
    } catch (err) {
      setPickError(String(err));
    } finally {
      setDownloading(false);
    }
  }

  function handleRemoveImage(kind: "image" | "mood" | "fr") {
    if (kind === "image") {
      if (form.image_path) {
        setReplacedMedia((r) => [...r, form.image_path!]);
      }
      set("image_path", null);
    } else if (kind === "mood") {
      if (form.mood_image_path) {
        setReplacedMedia((r) => [...r, form.mood_image_path!]);
      }
      set("mood_image_path", null);
    } else {
      if (form.fr_graph_path) {
        setReplacedMedia((r) => [...r, form.fr_graph_path!]);
      }
      set("fr_graph_path", null);
    }
  }

  /** Devices gallery: append a picked file. */
  async function handleAddGalleryImage() {
    setPickError(null);
    try {
      const rel = await pickImageFile();
      if (!rel) return;
      set("images", [...form.images, rel]);
    } catch (err) {
      setPickError(String(err));
    }
  }

  /** Devices gallery: download a pasted URL into media/ and append it. */
  async function handleDownloadGalleryImage() {
    const url = galleryUrl.trim();
    if (!url || galleryDownloading) return;
    setPickError(null);
    setGalleryDownloading(true);
    try {
      const name = `${form.brand} ${form.model}`.trim() || "image";
      const rel = await downloadImage(url, name);
      set("images", [...form.images, rel]);
      setGalleryUrl("");
    } catch (err) {
      setPickError(String(err));
    } finally {
      setGalleryDownloading(false);
    }
  }

  function handleRemoveGalleryImage(index: number) {
    const rel = form.images[index];
    if (rel) setReplacedMedia((r) => [...r, rel]);
    set(
      "images",
      form.images.filter((_, i) => i !== index),
    );
  }

  function handleMoveGalleryImage(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= form.images.length) return;
    const next = [...form.images];
    [next[index], next[target]] = [next[target], next[index]];
    set("images", next);
  }

  // ── Web auto-fetch (Phase 2) ──────────────────────────────────────────

  async function handleFetchSpecs() {
    if (
      !form.brand.trim() ||
      !form.model.trim() ||
      fetchState.status === "fetching"
    ) {
      return;
    }
    setFetchState({ status: "fetching" });
    try {
      const result = await fetchSpecs(
        form.brand.trim(),
        form.model.trim(),
        form.type,
      );
      setFetchState({ status: "done", result, applied: false });
      // Offer the curve immediately when nothing is set yet.
      if (result.frCurve && result.frCurve.length >= 2 && !form.fr_graph_path) {
        setPendingFr({
          curve: result.frCurve,
          source: result.frSource ?? "squig.link",
        });
      }
    } catch (err) {
      setPickError(String(err));
      setFetchState({ status: "idle" });
    }
  }

  /** Fill only fields that are currently empty; never overwrites. */
  async function handleApplyFetch() {
    if (fetchState.status !== "done" || fetchState.applied) return;
    const r = fetchState.result;
    const next = { ...form };
    if (!next.price.trim() && r.match?.price != null) {
      next.price = String(r.match.price);
    }
    if (!next.driver_type && r.driverType) {
      next.driver_type = r.driverType as DriverType;
    }
    if (!next.impedance_ohms.trim() && r.impedanceOhms != null) {
      next.impedance_ohms = String(r.impedanceOhms);
    }
    if (!next.sensitivity_db.trim() && r.sensitivityDb != null) {
      next.sensitivity_db = String(r.sensitivityDb);
    }
    setForm(next);

    // Product image: download into the media folder if we don't have one.
    if (r.imageUrl && !next.image_path) {
      try {
        const rel = await downloadImage(
          r.imageUrl,
          `${next.brand} ${next.model}`.trim() || "image",
        );
        setForm((f) => ({ ...f, image_path: rel }));
      } catch {
        // best-effort: image download failure is non-fatal
      }
    }

    setFetchState({ status: "done", result: r, applied: true });
    if (r.frCurve && r.frCurve.length >= 2 && !form.fr_graph_path) {
      setPendingFr({ curve: r.frCurve, source: r.frSource ?? "squig.link" });
    }
  }

  /** Render the fetched curve to a PNG and store it like any other image. */
  async function handleUseFetchedFr() {
    if (!pendingFr || form.fr_graph_path) return;
    setPickError(null);
    try {
      const label = `${form.brand.trim()} ${form.model.trim()}`.trim() || "FR";
      const bytes = await renderFrPng(
        pendingFr.curve,
        `${label} — ${pendingFr.source}`,
      );
      const rel = await saveMediaBytes(`FR ${label}.png`, bytes);
      set("fr_graph_path", rel);
      setPendingFr(null);
    } catch (err) {
      setPickError(String(err));
    }
  }

  /** Replace the form's PEQ bands with an OPRA profile (+ attribution). */
  function applyOpraProfile(profile: OpraProfile) {
    const { bands, notes } = toPeqBands(profile);
    if (bands.length === 0) {
      setPeqNote("This profile has no usable bands.");
      return;
    }
    setForm((f) => ({
      ...f,
      peq: toPeqDraft(bands),
      peq_source: opraSourceLabel(profile),
    }));
    setAppliedProfileId(profile.id);
    setPeqNote(notes.length > 0 ? notes.map(localizeNote).join(" · ") : null);
  }

  /** Open the native file picker, read + parse a PEQ file (XML/JSON). */
  async function handlePeqImport() {
    setImportError(null);
    setImportPending(null);
    try {
      const selected = await pickFile({
        multiple: false,
        filters: [
          {
            name: t("form.peqFileFilter"),
            extensions: ["xml", "json", "txt"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return;
      const text = await invoke<string>("read_text_file", { path: selected });
      const fileName = selected.split(/[\\/]/).pop() ?? "file";
      const result = parsePeqFile(fileName, text);
      setImportPending({
        bands: toPeqDraft(result.bands),
        notes: result.notes,
        fileName,
        source: result.attribution,
      });
    } catch (err) {
      setImportError(String(err));
    }
  }

  function applyImportPending() {
    if (!importPending) return;
    setForm((f) => ({
      ...f,
      peq: importPending.bands,
      peq_source: importPending.source ?? `Imported: ${importPending.fileName}`,
    }));
    setAppliedProfileId(null);
    setPeqNote(
      importPending.notes.length > 0
        ? importPending.notes.map(localizeNote).join(" · ")
        : null,
    );
    setImportPending(null);
  }

  /** Remove all PEQ bands + attribution. */
  function clearPeq() {
    setForm((f) => ({ ...f, peq: [], peq_source: "" }));
    setAppliedProfileId(null);
    setPeqNote(null);
  }

  async function handleSave() {
    const errs = validate(form, t, cat);
    if (
      form.purchase_date.trim() !== "" &&
      parseDateToISO(form.purchase_date, settings.dateFormat) == null
    ) {
      errs.purchase_date = t("form.validation.dateInvalid", {
        format: settings.dateFormat,
      });
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      return;
    }

    setSaving(true);
    try {
      const peq: PeqBand[] = form.peq.map((b) => ({
        type: b.type,
        freq_hz: Number(b.freq),
        gain_db: b.gain.trim() === "" ? 0 : Number(b.gain),
        q: b.q.trim() === "" ? 1 : Number(b.q),
      }));
      const custom: CustomField[] = form.custom
        .map((c) => ({ key: c.key.trim(), value: c.value.trim() }))
        .filter((c) => c.key !== "");

      const saved: Device = {
        id: device?.id ?? "",
        brand: form.brand.trim(),
        model: form.model.trim(),
        category: cat,
        type: cat === "headphones" ? (form.type as HeadphoneType) : null,
        device_type:
          cat === "devices" ? (form.device_type as DeviceType) : null,
        color: form.color.trim() || null,
        manufacturer_url: normalizeUrl(form.manufacturer_url),
        webshop_url: normalizeUrl(form.webshop_url),
        image_path: form.image_path,
        mood_image_path: form.mood_image_path,
        images: cat === "devices" ? form.images : [],
        price: parseOptFloat(form.price),
        purchase_date: parseDateToISO(form.purchase_date, settings.dateFormat),
        driver_type: (form.driver_type || null) as DriverType | null,
        impedance_ohms: parseOptInt(form.impedance_ohms),
        sensitivity_db: parseOptFloat(form.sensitivity_db),
        connector_type: (form.connector_type || null) as ConnectorType | null,
        tube_amp_suitable: form.tube_amp_suitable || null,
        drive_difficulty: (form.drive_difficulty ||
          null) as DriveDifficulty | null,
        sound_signature: (form.sound_signature ||
          null) as SoundSignature | null,
        soundstage_rating:
          form.soundstage_rating === ""
            ? null
            : Math.min(5, Math.max(0.5, Number(form.soundstage_rating))),
        imaging_rating:
          form.imaging_rating === ""
            ? null
            : Math.min(5, Math.max(0.5, Number(form.imaging_rating))),
        detail_retrieval_rating:
          form.detail_retrieval_rating === ""
            ? null
            : Math.min(5, Math.max(0.5, Number(form.detail_retrieval_rating))),
        timbre_rating:
          form.timbre_rating === ""
            ? null
            : Math.min(5, Math.max(0.5, Number(form.timbre_rating))),
        tonal_balance_rating:
          form.tonal_balance_rating === ""
            ? null
            : Math.min(5, Math.max(0.5, Number(form.tonal_balance_rating))),
        overall_rating:
          form.overall_rating === ""
            ? null
            : Math.min(5, Math.max(0.5, Number(form.overall_rating))),
        listening_notes: form.listening_notes.trim() || null,
        fr_graph_path: form.fr_graph_path,
        peq_settings: peq,
        peq_source: form.peq_source.trim() || null,
        custom_fields: custom,
        dac_chip: showDac(form.device_type)
          ? form.dac_chip.trim() || null
          : null,
        supported_formats: showDac(form.device_type)
          ? form.supported_formats.trim() || null
          : null,
        bluetooth_codecs: form.bluetooth_codecs,
        inputs: form.inputs,
        outputs: form.outputs,
        output_power: showAmp(form.device_type)
          ? form.output_power.trim() || null
          : null,
        snr_db: parseOptFloat(form.snr_db),
        thd_n: form.thd_n.trim() || null,
        load_min_ohms: showAmp(form.device_type)
          ? parseOptInt(form.load_min_ohms)
          : null,
        load_max_ohms: showAmp(form.device_type)
          ? parseOptInt(form.load_max_ohms)
          : null,
        channels:
          form.device_type === "AVR" ? form.channels.trim() || null : null,
        hdmi: form.device_type === "AVR" ? form.hdmi.trim() || null : null,
        room_correction:
          form.device_type === "AVR"
            ? form.room_correction.trim() || null
            : null,
        created_at: device?.created_at ?? new Date().toISOString(),
        updated_at: device?.updated_at ?? "",
      };

      const stored = await saveDevice(saved);
      for (const rel of replacedMedia) {
        void removeMediaFile(rel);
      }
      onSaved(stored);
    } catch (err) {
      setPickError(String(err));
    } finally {
      setSaving(false);
    }
  }

  /** Shared by both spec grids (headphones and devices). */
  const purchaseDateField = (
    <Field
      label={t("form.purchaseDate", { format: settings.dateFormat })}
      error={errors.purchase_date}
    >
      <div className="flex items-center gap-1.5">
        <input
          className={cls(inputCls, "min-w-0 flex-1")}
          value={form.purchase_date}
          onChange={(e) => set("purchase_date", e.target.value)}
          placeholder={settings.dateFormat}
          autoComplete="off"
        />
        <DateCalendar
          value={parseDateToISO(form.purchase_date, settings.dateFormat)}
          locale={localeFor(settings.language)}
          onSelect={(iso) =>
            set("purchase_date", formatDate(iso, settings.dateFormat) ?? iso)
          }
        />
      </div>
    </Field>
  );
  const priceField = (
    <Field
      label={t("form.price", { currency: currencySymbol(settings.currency) })}
      error={errors.price}
    >
      <input
        className={inputCls}
        type="number"
        min="0"
        step="0.01"
        value={form.price}
        onChange={(e) => set("price", e.target.value)}
        placeholder="349"
      />
    </Field>
  );

  return (
    <Modal
      title={
        device
          ? t("form.titleEdit", {
              name: `${device.brand} ${device.model}`,
            })
          : t("actions.addDevice")
      }
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      footer={
        <>
          <button className={btnSecondary} onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button
            className={btnPrimary}
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving
              ? t("form.saving")
              : device
                ? t("form.saveChanges")
                : t("actions.addDevice")}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Basic */}
        <FormSection title={t("form.basic")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={`${t("form.brand")} *`} error={errors.brand}>
              <input
                className={inputCls}
                list="brand-suggestions"
                value={form.brand}
                onChange={(e) => set("brand", e.target.value)}
                placeholder={t("form.phBrand")}
                autoComplete="off"
              />
              <datalist id="brand-suggestions">
                {brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </Field>
            <Field label={`${t("form.model")} *`} error={errors.model}>
              <input
                className={inputCls}
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder={t("form.phModel")}
              />
            </Field>
            <Field
              label={`${t("form.type")} *`}
              error={cat === "headphones" ? errors.type : errors.device_type}
            >
              <select
                className={cls(selectCls, "w-full")}
                value={cat === "headphones" ? form.type : form.device_type}
                onChange={(e) => {
                  const v = e.target.value;
                  if (cat === "headphones")
                    set("type", v as HeadphoneType | "");
                  else set("device_type", v as DeviceType | "");
                }}
              >
                <option value="">{t("form.select")}</option>
                {(cat === "headphones" ? HEADPHONE_TYPES : DEVICE_TYPES).map(
                  (v) => (
                    <option key={v} value={v}>
                      {enumLabel(v, t)}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Field label={t("form.color")}>
              <input
                className={inputCls}
                list="color-suggestions"
                value={form.color}
                onChange={(e) => set("color", e.target.value)}
                placeholder={t("form.phColor")}
                autoComplete="off"
              />
              <datalist id="color-suggestions">
                {colors.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label={t("form.rating")} error={errors.overall_rating}>
              <StarRating
                value={
                  form.overall_rating === ""
                    ? null
                    : Number(form.overall_rating)
                }
                onChange={(v) =>
                  set("overall_rating", v == null ? "" : String(v))
                }
              />
            </Field>
          </div>
        </FormSection>

        {/* Web fetch (headphones only — squig.link indexes measurements) */}
        {cat === "headphones" && (
          <FormSection title={t("form.webFetch")}>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={btnSecondary}
                onClick={() => void handleFetchSpecs()}
                disabled={
                  fetchState.status === "fetching" ||
                  !form.brand.trim() ||
                  !form.model.trim()
                }
              >
                <CloudDownload size={14} />
                {fetchState.status === "fetching"
                  ? t("form.fetching")
                  : t("form.fetchSpecs")}
              </button>
              <p className="text-xs text-tm-gray">
                {t("form.fetchHint", {
                  target:
                    form.brand.trim() && form.model.trim()
                      ? `“${form.brand.trim()} ${form.model.trim()}”`
                      : t("form.thisDevice"),
                })}
              </p>
            </div>

            {fetchState.status === "fetching" && (
              <p className="mt-3 animate-pulse text-sm text-tm-cyan">
                {t("form.fetchSearching")}
              </p>
            )}

            {fetchState.status === "done" && (
              <div className="mt-3 space-y-3">
                {fetchState.result.match ? (
                  <p className="text-sm text-tm-fg">
                    <span className="text-tm-purple">{t("form.match")}</span>{" "}
                    {fetchState.result.match.brand}{" "}
                    {fetchState.result.match.model}
                    {fetchState.result.match.price != null && (
                      <span className="text-tm-gray">
                        {" "}
                        {t("form.matchPrice", {
                          price: fetchState.result.match.price,
                        })}
                      </span>
                    )}{" "}
                    <span className="text-tm-gray">
                      {t("form.matchSite", {
                        site: fetchState.result.match.site,
                      })}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-tm-gray">{t("form.noMatch")}</p>
                )}

                {fetchState.result.frCurve &&
                  fetchState.result.frCurve.length >= 2 && (
                    <div className="max-w-md overflow-hidden">
                      <FrPreview curve={fetchState.result.frCurve} />
                      <p className="mt-1 text-xs text-tm-gray">
                        {t("form.measurementPoints", {
                          count: fetchState.result.frCurve.length,
                          source: fetchState.result.frSource
                            ? ` — ${fetchState.result.frSource}`
                            : "",
                        })}
                      </p>
                    </div>
                  )}

                <div className="flex flex-wrap gap-2 text-xs">
                  {fetchState.result.driverType && (
                    <SpecChip
                      label={t("fields.driver")}
                      value={fetchState.result.driverType}
                    />
                  )}
                  {fetchState.result.impedanceOhms != null && (
                    <SpecChip
                      label={t("fields.impedance")}
                      value={`${fetchState.result.impedanceOhms} Ω`}
                    />
                  )}
                  {fetchState.result.sensitivityDb != null && (
                    <SpecChip
                      label={t("fields.sensitivity")}
                      value={`${fetchState.result.sensitivityDb} dB`}
                    />
                  )}
                  {fetchState.result.imageUrl && (
                    <SpecChip
                      label={t("form.image")}
                      value={t("form.imageFound")}
                    />
                  )}
                  {fetchState.result.match?.price != null && (
                    <SpecChip
                      label={t("fields.price")}
                      value={String(fetchState.result.match.price)}
                    />
                  )}
                </div>

                {fetchState.result.notes.length > 0 && (
                  <ul className="space-y-1 text-xs text-tm-gray">
                    {fetchState.result.notes.map((n, i) => (
                      <li key={i}>· {localizeNote(n)}</li>
                    ))}
                  </ul>
                )}

                <button
                  className={btnPrimary}
                  onClick={() => void handleApplyFetch()}
                  disabled={fetchState.applied}
                >
                  {fetchState.applied ? t("form.applied") : t("form.apply")}
                </button>
              </div>
            )}
          </FormSection>
        )}

        {/* Technical specs */}
        <FormSection title={t("detail.specs")}>
          {cat === "headphones" ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label={t("form.impedance")} error={errors.impedance_ohms}>
                <input
                  className={inputCls}
                  type="number"
                  min="0"
                  step="1"
                  value={form.impedance_ohms}
                  onChange={(e) => set("impedance_ohms", e.target.value)}
                  placeholder="300"
                />
              </Field>
              <Field
                label={t("form.sensitivity")}
                error={errors.sensitivity_db}
              >
                <input
                  className={inputCls}
                  type="number"
                  step="0.1"
                  value={form.sensitivity_db}
                  onChange={(e) => set("sensitivity_db", e.target.value)}
                  placeholder="104"
                />
              </Field>
              <Field label={t("fields.driveDifficulty")}>
                <select
                  className={cls(selectCls, "w-full")}
                  value={form.drive_difficulty}
                  onChange={(e) =>
                    set(
                      "drive_difficulty",
                      e.target.value as DriveDifficulty | "",
                    )
                  }
                >
                  <option value="">{t("form.unknown")}</option>
                  {DRIVE_DIFFICULTIES.map((v) => (
                    <option key={v} value={v}>
                      {enumLabel(v, t)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("form.driverType")}>
                <select
                  className={cls(selectCls, "w-full")}
                  value={form.driver_type}
                  onChange={(e) =>
                    set("driver_type", e.target.value as DriverType | "")
                  }
                >
                  <option value="">{t("form.unknown")}</option>
                  {DRIVER_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {enumLabel(v, t)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("form.connector")}>
                <select
                  className={cls(selectCls, "w-full")}
                  value={form.connector_type}
                  onChange={(e) =>
                    set("connector_type", e.target.value as ConnectorType | "")
                  }
                >
                  <option value="">{t("form.unknown")}</option>
                  {CONNECTOR_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {enumLabel(v, t)}
                    </option>
                  ))}
                </select>
              </Field>
              {purchaseDateField}
              {priceField}
              <Field
                label={t("fields.tubeAmp")}
                className="col-span-2 sm:col-span-3"
              >
                <div className="flex flex-wrap items-center gap-4">
                  <select
                    className={selectCls}
                    value={form.tube_amp_suitable}
                    onChange={(e) =>
                      set(
                        "tube_amp_suitable",
                        e.target.value as TubeBadgeValue | "",
                      )
                    }
                  >
                    <option value="">{t("form.tubeAuto")}</option>
                    {TUBE_BADGES.map((b) => (
                      <option key={b} value={b}>
                        {tubeBadgeLabel(b, (k) => t(k))}
                      </option>
                    ))}
                  </select>
                  {previewBadge && form.tube_amp_suitable === "" && (
                    <div className="flex items-center gap-2 text-xs text-tm-gray">
                      <span>{t("form.ruleResult")}</span>
                      <Tip label={t("fields.tubeAmp")}>
                        <TubeBadge
                          badge={previewBadge}
                          size="sm"
                          tooltip={null}
                        />
                      </Tip>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs text-tm-gray">
                  {describeTubeRule((k) => t(k))}
                </p>
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {showDac(form.device_type) && (
                <>
                  <Field label={t("fields.dacChip")}>
                    <input
                      className={inputCls}
                      value={form.dac_chip}
                      onChange={(e) => set("dac_chip", e.target.value)}
                      placeholder="ES9219QN"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label={t("fields.supportedFormats")}>
                    <input
                      className={inputCls}
                      value={form.supported_formats}
                      onChange={(e) => set("supported_formats", e.target.value)}
                      placeholder="PCM 24/192 · DSD256"
                      autoComplete="off"
                    />
                  </Field>
                </>
              )}
              <Field label={t("fields.snr")} error={errors.snr_db}>
                <input
                  className={inputCls}
                  type="number"
                  step="0.1"
                  value={form.snr_db}
                  onChange={(e) => set("snr_db", e.target.value)}
                  placeholder="118"
                />
              </Field>
              <Field label={t("fields.thdN")}>
                <input
                  className={inputCls}
                  value={form.thd_n}
                  onChange={(e) => set("thd_n", e.target.value)}
                  placeholder="0.001 %"
                  autoComplete="off"
                />
              </Field>
              {showAmp(form.device_type) && (
                <>
                  <Field label={t("fields.outputPower")}>
                    <input
                      className={inputCls}
                      value={form.output_power}
                      onChange={(e) => set("output_power", e.target.value)}
                      placeholder="5 W @ 32 Ω"
                      autoComplete="off"
                    />
                  </Field>
                  <Field
                    label={t("fields.loadImpedance")}
                    className="col-span-2"
                    error={errors.load_min_ohms || errors.load_max_ohms}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        className={inputCls}
                        type="number"
                        min="0"
                        step="1"
                        value={form.load_min_ohms}
                        onChange={(e) => set("load_min_ohms", e.target.value)}
                        placeholder="16"
                      />
                      <span className="text-tm-gray">–</span>
                      <input
                        className={inputCls}
                        type="number"
                        min="0"
                        step="1"
                        value={form.load_max_ohms}
                        onChange={(e) => set("load_max_ohms", e.target.value)}
                        placeholder="600"
                      />
                      <span className="text-xs text-tm-gray">Ω</span>
                    </div>
                  </Field>
                </>
              )}
              <Field
                label={t("fields.inputs")}
                className="col-span-2 sm:col-span-3"
              >
                <TagInput
                  id="inputs"
                  value={form.inputs}
                  onChange={(v) => set("inputs", v)}
                  suggestions={INPUT_SUGGESTIONS}
                  placeholder={t("form.tagPlaceholder")}
                />
              </Field>
              <Field
                label={t("fields.outputs")}
                className="col-span-2 sm:col-span-3"
              >
                <TagInput
                  id="outputs"
                  value={form.outputs}
                  onChange={(v) => set("outputs", v)}
                  suggestions={OUTPUT_SUGGESTIONS}
                  placeholder={t("form.tagPlaceholder")}
                />
              </Field>
              <Field
                label={t("fields.bluetoothCodecs")}
                className="col-span-2 sm:col-span-3"
              >
                <TagInput
                  id="codecs"
                  value={form.bluetooth_codecs}
                  onChange={(v) => set("bluetooth_codecs", v)}
                  suggestions={CODEC_SUGGESTIONS}
                  placeholder={t("form.tagPlaceholder")}
                />
              </Field>
              {form.device_type === "AVR" && (
                <>
                  <Field label={t("fields.channels")}>
                    <input
                      className={inputCls}
                      value={form.channels}
                      onChange={(e) => set("channels", e.target.value)}
                      placeholder="7.1(4)"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label={t("fields.hdmi")}>
                    <input
                      className={inputCls}
                      value={form.hdmi}
                      onChange={(e) => set("hdmi", e.target.value)}
                      placeholder="4 in / 1 out (eARC)"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label={t("fields.roomCorrection")}>
                    <input
                      className={inputCls}
                      value={form.room_correction}
                      onChange={(e) => set("room_correction", e.target.value)}
                      placeholder="Audyssey MultEQ"
                      autoComplete="off"
                    />
                  </Field>
                </>
              )}
              {purchaseDateField}
              {priceField}
            </div>
          )}
        </FormSection>

        {/* Extra */}
        <FormSection title={t("detail.custom")}>
          <div className="space-y-2">
            <datalist id="custom-key-suggestions">
              {customKeys.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
            {form.custom.length === 0 && (
              <p className="text-sm text-tm-gray">{t("form.noCustom")}</p>
            )}
            {form.custom.map((cf, i) => (
              <div key={i} className="flex items-start gap-2">
                <input
                  className={cls(inputCls, "w-48")}
                  value={cf.key}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      custom: f.custom.map((c, idx) =>
                        idx === i ? { ...c, key: e.target.value } : c,
                      ),
                    }))
                  }
                  placeholder={t("form.phCustomKey")}
                  list="custom-key-suggestions"
                  autoComplete="off"
                />
                <input
                  className={inputCls}
                  value={cf.value}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      custom: f.custom.map((c, idx) =>
                        idx === i ? { ...c, value: e.target.value } : c,
                      ),
                    }))
                  }
                  placeholder={t("form.phCustomValue")}
                />
                <button
                  className="mt-1 rounded p-1.5 text-tm-gray transition hover:bg-tm-dark hover:text-tm-red"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      custom: f.custom.filter((_, idx) => idx !== i),
                    }))
                  }
                  aria-label={t("form.ariaRemoveCustom", { index: i + 1 })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              className={btnSecondary}
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  custom: [...f.custom, { key: "", value: "" }],
                }))
              }
            >
              <Plus size={14} />
              {t("form.addCustom")}
            </button>
          </div>
        </FormSection>

        {/* Sound (headphones only) */}
        {cat === "headphones" && (
          <FormSection title={t("detail.theSound")}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label={t("fields.soundSignature")}>
                <select
                  className={cls(selectCls, "w-full")}
                  value={form.sound_signature}
                  onChange={(e) =>
                    set(
                      "sound_signature",
                      e.target.value as SoundSignature | "",
                    )
                  }
                >
                  <option value="">{t("form.unknown")}</option>
                  {SOUND_SIGNATURES.map((v) => (
                    <option key={v} value={v}>
                      {enumLabel(v, t)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t("form.soundstage")}
                error={errors.soundstage_rating}
              >
                <DotRating
                  label={t("form.soundstage")}
                  value={
                    form.soundstage_rating === ""
                      ? null
                      : Number(form.soundstage_rating)
                  }
                  onChange={(v) =>
                    set("soundstage_rating", v == null ? "" : String(v))
                  }
                />
              </Field>
              <Field label={t("form.imaging")} error={errors.imaging_rating}>
                <DotRating
                  label={t("form.imaging")}
                  value={
                    form.imaging_rating === ""
                      ? null
                      : Number(form.imaging_rating)
                  }
                  onChange={(v) =>
                    set("imaging_rating", v == null ? "" : String(v))
                  }
                />
              </Field>
              <Field
                label={t("form.detailRetrieval")}
                error={errors.detail_retrieval_rating}
              >
                <DotRating
                  label={t("form.detailRetrieval")}
                  value={
                    form.detail_retrieval_rating === ""
                      ? null
                      : Number(form.detail_retrieval_rating)
                  }
                  onChange={(v) =>
                    set("detail_retrieval_rating", v == null ? "" : String(v))
                  }
                />
              </Field>
              <Field label={t("form.timbre")} error={errors.timbre_rating}>
                <DotRating
                  label={t("form.timbre")}
                  value={
                    form.timbre_rating === ""
                      ? null
                      : Number(form.timbre_rating)
                  }
                  onChange={(v) =>
                    set("timbre_rating", v == null ? "" : String(v))
                  }
                />
              </Field>
              <Field
                label={t("form.tonalBalance")}
                error={errors.tonal_balance_rating}
              >
                <DotRating
                  label={t("form.tonalBalance")}
                  value={
                    form.tonal_balance_rating === ""
                      ? null
                      : Number(form.tonal_balance_rating)
                  }
                  onChange={(v) =>
                    set("tonal_balance_rating", v == null ? "" : String(v))
                  }
                />
              </Field>
            </div>
          </FormSection>
        )}

        {/* Listening notes */}
        <FormSection title={t("detail.notes")}>
          <textarea
            className={cls(inputCls, "min-h-24 resize-y")}
            value={form.listening_notes}
            onChange={(e) => set("listening_notes", e.target.value)}
            placeholder={t("form.phListeningNotes")}
          />
        </FormSection>

        {/* Images */}
        <FormSection title={t("form.images")}>
          {cat === "headphones" ? (
            <div className="space-y-4">
            <Field label={t("form.moodImage")}>
              <div className="flex items-start gap-3">
                <div className="w-44 shrink-0 overflow-hidden rounded border border-tm-dark">
                  <MediaImage
                    relPath={form.mood_image_path}
                    className="aspect-video w-full"
                    placeholderIcon={28}
                  />
                </div>
                <div className="flex flex-col items-start gap-2 pt-1">
                  <button
                    className={btnSecondary}
                    onClick={() => void handlePickImage("mood")}
                  >
                    <FolderOpen size={14} />
                    {form.mood_image_path
                      ? t("form.replaceImage")
                      : t("form.pickImage")}
                  </button>
                  {form.mood_image_path && (
                    <button
                      className="text-xs text-tm-red hover:underline"
                      onClick={() => handleRemoveImage("mood")}
                    >
                      {t("form.removeImage")}
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      value={moodImageUrl}
                      onChange={(e) => setMoodImageUrl(e.target.value)}
                      placeholder={t("form.imageUrlPlaceholder")}
                      className="w-64 rounded border border-tm-dark bg-tm-darker px-2.5 py-1.5 text-sm text-tm-fg placeholder:text-tm-gray focus:border-tm-accent focus:outline-none"
                    />
                    <button
                      className={btnSecondary}
                      onClick={() => void handleDownloadImage("mood")}
                      disabled={moodImageDownloading || !moodImageUrl.trim()}
                    >
                      <CloudDownload size={14} />
                      {moodImageDownloading
                        ? t("form.downloading")
                        : t("form.downloadImage")}
                    </button>
                  </div>
                </div>
              </div>
            </Field>
            <Field label={t("form.productImage")}>
              <div className="flex items-start gap-3">
                <div className="w-44 shrink-0 overflow-hidden rounded border border-tm-dark">
                  <MediaImage
                    relPath={form.image_path}
                    className="aspect-video w-full"
                    placeholderIcon={28}
                  />
                </div>
                <div className="flex flex-col items-start gap-2 pt-1">
                  <button
                    className={btnSecondary}
                    onClick={() => void handlePickImage("image")}
                  >
                    <FolderOpen size={14} />
                    {form.image_path
                      ? t("form.replaceImage")
                      : t("form.pickImage")}
                  </button>
                  {form.image_path && (
                    <button
                      className="text-xs text-tm-red hover:underline"
                      onClick={() => handleRemoveImage("image")}
                    >
                      {t("form.removeImage")}
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder={t("form.imageUrlPlaceholder")}
                      className="w-64 rounded border border-tm-dark bg-tm-darker px-2.5 py-1.5 text-sm text-tm-fg placeholder:text-tm-gray focus:border-tm-accent focus:outline-none"
                    />
                    <button
                      className={btnSecondary}
                      onClick={() => void handleDownloadImage("image")}
                      disabled={imageDownloading || !imageUrl.trim()}
                    >
                      <CloudDownload size={14} />
                      {imageDownloading
                        ? t("form.downloading")
                        : t("form.downloadImage")}
                    </button>
                  </div>
                </div>
              </div>
            </Field>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label={t("form.moodImage")}>
                <div className="flex items-start gap-3">
                  <div className="w-44 shrink-0 overflow-hidden rounded border border-tm-dark">
                    <MediaImage
                      relPath={form.mood_image_path}
                      className="aspect-video w-full"
                      placeholderIcon={28}
                    />
                  </div>
                  <div className="flex flex-col items-start gap-2 pt-1">
                    <button
                      className={btnSecondary}
                      onClick={() => void handlePickImage("mood")}
                    >
                      <FolderOpen size={14} />
                      {form.mood_image_path
                        ? t("form.replaceImage")
                        : t("form.pickImage")}
                    </button>
                    {form.mood_image_path && (
                      <button
                        className="text-xs text-tm-red hover:underline"
                        onClick={() => handleRemoveImage("mood")}
                      >
                        {t("form.removeImage")}
                      </button>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="url"
                        value={moodImageUrl}
                        onChange={(e) => setMoodImageUrl(e.target.value)}
                        placeholder={t("form.imageUrlPlaceholder")}
                        className="w-64 rounded border border-tm-dark bg-tm-darker px-2.5 py-1.5 text-sm text-tm-fg placeholder:text-tm-gray focus:border-tm-accent focus:outline-none"
                      />
                      <button
                        className={btnSecondary}
                        onClick={() => void handleDownloadImage("mood")}
                        disabled={moodImageDownloading || !moodImageUrl.trim()}
                      >
                        <CloudDownload size={14} />
                        {moodImageDownloading
                          ? t("form.downloading")
                          : t("form.downloadImage")}
                      </button>
                    </div>
                  </div>
                </div>
              </Field>
              <p className="text-xs text-tm-gray">
                {t("form.firstImageHint")}
              </p>
              {form.images.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                  {form.images.map((rel, i) => (
                    <div
                      key={rel}
                      className="group relative overflow-hidden rounded border border-tm-dark"
                    >
                      <MediaImage
                        relPath={rel}
                        className="aspect-video w-full"
                        placeholderIcon={24}
                      />
                      {i === 0 && (
                        <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white">
                          {t("form.coverTag")}
                        </span>
                      )}
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/50 p-1 opacity-0 transition group-hover:opacity-100">
                        <div className="flex gap-1">
                          <button
                            className="rounded p-1 text-white transition hover:bg-white/20 disabled:opacity-30"
                            disabled={i === 0}
                            onClick={() => handleMoveGalleryImage(i, -1)}
                            aria-label={t("form.moveLeft")}
                            title={t("form.moveLeft")}
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <button
                            className="rounded p-1 text-white transition hover:bg-white/20 disabled:opacity-30"
                            disabled={i === form.images.length - 1}
                            onClick={() => handleMoveGalleryImage(i, 1)}
                            aria-label={t("form.moveRight")}
                            title={t("form.moveRight")}
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                        <button
                          className="rounded p-1 text-white transition hover:bg-red-500/60"
                          onClick={() => handleRemoveGalleryImage(i)}
                          aria-label={t("form.removeImage")}
                          title={t("form.removeImage")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className={btnSecondary}
                  onClick={() => void handleAddGalleryImage()}
                >
                  <Plus size={14} />
                  {t("form.addImage")}
                </button>
                <input
                  type="url"
                  value={galleryUrl}
                  onChange={(e) => setGalleryUrl(e.target.value)}
                  placeholder={t("form.imageUrlPlaceholder")}
                  className="w-64 rounded border border-tm-dark bg-tm-darker px-2.5 py-1.5 text-sm text-tm-fg placeholder:text-tm-gray focus:border-tm-accent focus:outline-none"
                />
                <button
                  className={btnSecondary}
                  onClick={() => void handleDownloadGalleryImage()}
                  disabled={galleryDownloading || !galleryUrl.trim()}
                >
                  <CloudDownload size={14} />
                  {galleryDownloading
                    ? t("form.downloading")
                    : t("form.downloadImage")}
                </button>
              </div>
            </div>
          )}
        </FormSection>

        {/* Links */}
        <FormSection title={t("form.links")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={t("form.manufacturerUrl")}
              error={errors.manufacturer_url}
            >
              <input
                className={inputCls}
                value={form.manufacturer_url}
                onChange={(e) => set("manufacturer_url", e.target.value)}
                placeholder={t("form.phManufacturerUrl")}
                autoComplete="off"
              />
            </Field>
            <Field label={t("form.webshop")} error={errors.webshop_url}>
              <input
                className={inputCls}
                value={form.webshop_url}
                onChange={(e) => set("webshop_url", e.target.value)}
                placeholder={t("form.phWebshop")}
                autoComplete="off"
              />
            </Field>
          </div>
        </FormSection>

        {/* Frequency response (headphones only) */}
        {cat === "headphones" && (
          <FormSection title={t("detail.fr")}>
            <Field label={t("form.frGraph")}>
              <div className="flex items-start gap-3">
                <div className="w-44 shrink-0 overflow-hidden rounded border border-tm-dark">
                  <MediaImage
                    relPath={form.fr_graph_path}
                    className="aspect-video w-full bg-tm-darker object-contain"
                    placeholderIcon={28}
                  />
                </div>
                <div className="flex flex-col items-start gap-2 pt-1">
                  <button
                    className={btnSecondary}
                    onClick={() => void handlePickImage("fr")}
                  >
                    <FolderOpen size={14} />
                    {form.fr_graph_path
                      ? t("form.replaceGraph")
                      : t("form.pickGraph")}
                  </button>
                  {pendingFr && !form.fr_graph_path && (
                    <button
                      className={btnSecondary}
                      onClick={() => void handleUseFetchedFr()}
                    >
                      <AudioLines size={14} />
                      {t("form.useFetchedCurve", {
                        count: pendingFr.curve.length,
                      })}
                    </button>
                  )}
                  {form.fr_graph_path && (
                    <button
                      className="text-xs text-tm-red hover:underline"
                      onClick={() => handleRemoveImage("fr")}
                    >
                      {t("form.removeGraph")}
                    </button>
                  )}
                </div>
              </div>
            </Field>
          </FormSection>
        )}

        {/* PEQ (headphones only) */}
        {cat === "headphones" && (
          <FormSection title={t("detail.peq")}>
            <div className="space-y-3">
              {form.peq.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3 rounded border border-tm-dark bg-tm-darker p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {t("form.peqLoaded", { count: form.peq.length })}
                    </p>
                    {form.peq_source && (
                      <p
                        className="truncate text-xs text-tm-gray"
                        title={form.peq_source}
                      >
                        {t("detail.source", { source: form.peq_source })}
                      </p>
                    )}
                    {peqNote && (
                      <p className="mt-0.5 text-xs text-tm-yellow">{peqNote}</p>
                    )}
                  </div>
                  <button
                    className="text-xs text-tm-red hover:underline"
                    onClick={clearPeq}
                  >
                    {t("form.clearPeq")}
                  </button>
                </div>
              ) : (
                !importPending && (
                  <p className="text-sm text-tm-gray">{t("form.noPeq")}</p>
                )
              )}

              {opraCheck.status === "idle" && (
                <p className="text-xs text-tm-gray">{t("form.opraIdle")}</p>
              )}
              {opraCheck.status === "checking" && (
                <p className="animate-pulse text-sm text-tm-cyan">
                  {t("form.opraChecking")}
                </p>
              )}
              {opraCheck.status === "done" && opraCheck.result && (
                <>
                  {opraCheck.result.candidates.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-tm-gray">
                        {t("form.opraFound")}
                      </p>
                      {opraCheck.result.candidates.map((c) => (
                        <div
                          key={`${c.vendor}/${c.name}`}
                          className="rounded border border-tm-dark p-3"
                        >
                          <p className="text-sm">
                            <strong>
                              {c.vendor} {c.name}
                            </strong>{" "}
                            <span className="text-xs text-tm-gray">
                              {c.subtype.replace(/_/g, " ")}
                            </span>
                          </p>
                          <div className="mt-2 space-y-1.5">
                            {c.profiles.map((p) => (
                              <div
                                key={p.id}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <button
                                  className={btnSecondary}
                                  onClick={() => applyOpraProfile(p)}
                                >
                                  {p.author} — {p.details || p.id}
                                  {appliedProfileId === p.id
                                    ? ` ${t("form.appliedTag")}`
                                    : ""}
                                </button>
                                <span className="text-xs text-tm-gray">
                                  {t("common.bands", { count: p.bands.length })}
                                  {p.overallGainDb !== 0 &&
                                    ` · ${t("form.opraOverall", {
                                      gain: `${p.overallGainDb > 0 ? "+" : ""}${p.overallGainDb}`,
                                    })}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {opraCheck.result.note && (
                        <p className="text-xs text-tm-yellow">
                          {localizeNote(opraCheck.result.note)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {opraCheck.result.note ? (
                        <p className="text-xs text-tm-yellow">
                          {localizeNote(opraCheck.result.note)}
                        </p>
                      ) : (
                        <p className="text-xs text-tm-gray">
                          {t("form.opraNone")}
                        </p>
                      )}
                      <button
                        className={btnSecondary}
                        onClick={() => void handlePeqImport()}
                      >
                        <FileUp size={14} />
                        {t("form.importPeq")}
                      </button>
                    </div>
                  )}
                </>
              )}

              {importError && (
                <p className="text-xs text-tm-red">
                  {localizeNote(importError)}
                </p>
              )}
              {importPending && (
                <div className="rounded border border-tm-border bg-tm-dark p-3 text-sm">
                  <p>
                    {t("form.importReady", {
                      count: importPending.bands.length,
                      file: importPending.fileName,
                    })}
                  </p>
                  {importPending.notes.map((n, i) => (
                    <p key={i} className="mt-1 text-xs text-tm-yellow">
                      {n}
                    </p>
                  ))}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className={btnPrimary} onClick={applyImportPending}>
                      {t("form.replaceBands")}
                    </button>
                    <button
                      className={btnSecondary}
                      onClick={() => setImportPending(null)}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </FormSection>
        )}

        {pickError && (
          <p className={cls(btnDanger, "w-fit py-1 text-xs")}>
            {localizeNote(pickError)}
          </p>
        )}
      </div>
    </Modal>
  );
}

function FormSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-tm-dark bg-tm-darker/40 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-tm-gray">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-tm-gray">{label}</label>
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs text-tm-red">{error}</p>}
    </div>
  );
}

function SpecChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded border border-tm-dark bg-tm-darker px-2 py-1 text-tm-fg">
      <span className="text-tm-gray">{label}:</span> {value}
    </span>
  );
}
