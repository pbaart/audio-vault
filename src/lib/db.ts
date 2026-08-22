import Database from "@tauri-apps/plugin-sql";
import type { PeqBand, PeqType, Device, CustomField } from "../types";
import { getAppPaths } from "./paths";

/** Static SQL — all values are bound via `?` placeholders; no string interpolation. */
const UPDATE_SQL =
  "UPDATE devices SET brand = ?, model = ?, type = ?, color = ?, " +
  "manufacturer_url = ?, webshop_url = ?, image_path = ?, mood_image_path = ?, " +
  "price = ?, purchase_date = ?, driver_type = ?, impedance_ohms = ?, " +
  "sensitivity_db = ?, connector_type = ?, tube_amp_suitable = ?, " +
  "drive_difficulty = ?, sound_signature = ?, soundstage_rating = ?, " +
  "imaging_rating = ?, detail_retrieval_rating = ?, timbre_rating = ?, " +
  "tonal_balance_rating = ?, overall_rating = ?, listening_notes = ?, " +
  "fr_graph_path = ?, peq_settings = ?, peq_source = ?, custom_fields = ?, " +
  "updated_at = ? " +
  "WHERE id = ?";

const INSERT_SQL =
  "INSERT INTO devices (id, brand, model, type, color, manufacturer_url, " +
  "webshop_url, image_path, mood_image_path, price, " +
  "purchase_date, driver_type, impedance_ohms, sensitivity_db, connector_type, " +
  "tube_amp_suitable, drive_difficulty, sound_signature, soundstage_rating, " +
  "imaging_rating, detail_retrieval_rating, timbre_rating, " +
  "tonal_balance_rating, overall_rating, listening_notes, fr_graph_path, " +
  "peq_settings, peq_source, custom_fields, updated_at) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

let dbPromise: Promise<Database> | null = null;

/**
 * Load (once) the SQLite database. The URL must match the one the Rust
 * side registered migrations for, so both derive it from `init_app_data`.
 */
async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const paths = await getAppPaths();
      return Database.load(`sqlite:${paths.db}`);
    })();
  }
  return dbPromise;
}

/** Generate a random UUIDv4 (works without `crypto.randomUUID`). */
function randomUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const asString = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

const asInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) ? v : null;

/** Current UTC time in SQLite CURRENT_TIMESTAMP format (`YYYY-MM-DD HH:MM:SS`). */
function sqlNow(): string {
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
}

/**
 * `overall_rating` is stored as 2× the rating so half stars fit in an
 * INTEGER column (1–10 ⇔ 0.5–5.0); NULL means unrated.
 */
function ratingFromRow(raw: unknown): number | null {
  const doubled = asInt(raw);
  return doubled == null ? null : doubled / 2;
}

const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function parseJsonArray(raw: unknown): unknown[] {
  if (typeof raw !== "string" || raw.length === 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const PEQ_TYPE_SET: ReadonlySet<string> = new Set(["PK", "LSC", "HSC"]);

function parsePeqSettings(raw: unknown): PeqBand[] {
  return parseJsonArray(raw).filter((b): b is PeqBand => {
    if (typeof b !== "object" || b === null) {
      return false;
    }
    const o = b as Record<string, unknown>;
    const type = o.type as PeqType;
    return (
      typeof type === "string" &&
      PEQ_TYPE_SET.has(type) &&
      typeof o.freq_hz === "number" &&
      Number.isFinite(o.freq_hz) &&
      typeof o.gain_db === "number" &&
      Number.isFinite(o.gain_db) &&
      typeof o.q === "number" &&
      Number.isFinite(o.q)
    );
  });
}

function parseCustomFields(raw: unknown): CustomField[] {
  return parseJsonArray(raw).filter(
    (c): c is CustomField =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as Record<string, unknown>).key === "string" &&
      typeof (c as Record<string, unknown>).value === "string",
  );
}

type Row = Record<string, unknown>;

function rowToDevice(row: Row): Device {
  return {
    id: asString(row.id) ?? "",
    brand: asString(row.brand) ?? "",
    model: asString(row.model) ?? "",
    type: (asString(row.type) ?? "Over-Ear") as Device["type"],
    color: asString(row.color),
    manufacturer_url: asString(row.manufacturer_url),
    webshop_url: asString(row.webshop_url),
    image_path: asString(row.image_path),
    mood_image_path: asString(row.mood_image_path),
    price: asNum(row.price),
    purchase_date: asString(row.purchase_date),
    driver_type: asString(row.driver_type) as Device["driver_type"],
    impedance_ohms: asInt(row.impedance_ohms),
    sensitivity_db: asNum(row.sensitivity_db),
    connector_type: asString(row.connector_type) as Device["connector_type"],
    tube_amp_suitable: asString(
      row.tube_amp_suitable,
    ) as Device["tube_amp_suitable"],
    drive_difficulty: asString(
      row.drive_difficulty,
    ) as Device["drive_difficulty"],
    sound_signature: asString(row.sound_signature) as Device["sound_signature"],
    soundstage_rating: ratingFromRow(row.soundstage_rating),
    imaging_rating: ratingFromRow(row.imaging_rating),
    detail_retrieval_rating: ratingFromRow(row.detail_retrieval_rating),
    timbre_rating: ratingFromRow(row.timbre_rating),
    tonal_balance_rating: ratingFromRow(row.tonal_balance_rating),
    overall_rating: ratingFromRow(row.overall_rating),
    listening_notes: asString(row.listening_notes),
    fr_graph_path: asString(row.fr_graph_path),
    peq_settings: parsePeqSettings(row.peq_settings),
    peq_source: asString(row.peq_source),
    custom_fields: parseCustomFields(row.custom_fields),
    created_at: asString(row.created_at) ?? "",
    // Pre-v15 rows have no updated_at — treat them as modified at creation.
    updated_at: asString(row.updated_at) ?? asString(row.created_at) ?? "",
  };
}

export async function listDevices(): Promise<Device[]> {
  const db = await getDb();
  const rows = (await db.select<Row[]>("SELECT * FROM devices", [])) ?? [];
  return rows.map(rowToDevice);
}

/**
 * Distinct non-empty brands currently in the database, for the brand
 * input's autocomplete list. Case-insensitive duplicates are collapsed
 * (first occurrence wins, keeping its original casing).
 */
export async function getDistinctBrands(): Promise<string[]> {
  const db = await getDb();
  const rows =
    (await db.select<Row[]>(
      "SELECT DISTINCT brand FROM devices WHERE brand != '' " +
        "ORDER BY brand COLLATE NOCASE",
    )) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const brand = asString(row.brand)?.trim();
    if (!brand) continue;
    const key = brand.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(brand);
  }
  return out;
}

/**
 * Distinct non-empty colors currently in the database, for the color
 * input's autocomplete list. Case-insensitive duplicates are collapsed
 * (first occurrence wins, keeping its original casing).
 */
export async function getDistinctColors(): Promise<string[]> {
  const db = await getDb();
  const rows =
    (await db.select<Row[]>(
      "SELECT DISTINCT color FROM devices WHERE color != '' " +
        "ORDER BY color COLLATE NOCASE",
    )) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const color = asString(row.color)?.trim();
    if (!color) continue;
    const key = color.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(color);
  }
  return out;
}

/**
 * Distinct non-empty custom-field keys currently in the database, for the
 * custom key input's autocomplete list. Custom fields are stored as a JSON
 * array per device, so keys are expanded with json_each. Case-insensitive
 * duplicates are collapsed (first occurrence wins, keeping its original
 * casing).
 */
export async function getDistinctCustomKeys(): Promise<string[]> {
  const db = await getDb();
  const rows =
    (await db.select<Row[]>(
      "SELECT DISTINCT json_extract(je.value, '$.key') AS key " +
        "FROM devices d, json_each(d.custom_fields) je " +
        "WHERE d.custom_fields IS NOT NULL AND d.custom_fields != '' " +
        "AND d.custom_fields != '[]' " +
        "AND TRIM(COALESCE(json_extract(je.value, '$.key'), '')) != '' " +
        "ORDER BY key COLLATE NOCASE",
    )) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const key = asString(row.key)?.trim();
    if (!key) continue;
    const k = key.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(key);
  }
  return out;
}

export async function getDevice(id: string): Promise<Device | null> {
  const db = await getDb();
  const rows =
    (await db.select<Row[]>("SELECT * FROM devices WHERE id = ?", [id])) ?? [];
  if (rows.length === 0) {
    return null;
  }
  return rowToDevice(rows[0]);
}

/**
 * Insert (empty id) or update (existing id) a device. Returns the stored
 * device, with a generated id when one was missing.
 */
export async function saveDevice(device: Device): Promise<Device> {
  const db = await getDb();
  const values: (string | number | null)[] = [
    device.brand,
    device.model,
    device.type,
    device.color,
    device.manufacturer_url,
    device.webshop_url,
    device.image_path,
    device.mood_image_path,
    device.price,
    device.purchase_date,
    device.driver_type,
    device.impedance_ohms,
    device.sensitivity_db,
    device.connector_type,
    device.tube_amp_suitable,
    device.drive_difficulty,
    device.sound_signature,
    device.soundstage_rating == null
      ? null
      : Math.round(device.soundstage_rating * 2),
    device.imaging_rating == null
      ? null
      : Math.round(device.imaging_rating * 2),
    device.detail_retrieval_rating == null
      ? null
      : Math.round(device.detail_retrieval_rating * 2),
    device.timbre_rating == null ? null : Math.round(device.timbre_rating * 2),
    device.tonal_balance_rating == null
      ? null
      : Math.round(device.tonal_balance_rating * 2),
    device.overall_rating == null
      ? null
      : Math.round(device.overall_rating * 2),
    device.listening_notes,
    device.fr_graph_path,
    JSON.stringify(device.peq_settings),
    device.peq_source,
    JSON.stringify(device.custom_fields),
  ];

  const now = sqlNow();
  if (device.id) {
    await db.execute(UPDATE_SQL, [...values, now, device.id]);
    return { ...device, updated_at: now };
  }

  const stored: Device = { ...device, id: randomUuid(), updated_at: now };
  await db.execute(INSERT_SQL, [stored.id, ...values, now]);
  return stored;
}

export async function deleteDevice(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM devices WHERE id = ?", [id]);
}
