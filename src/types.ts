export type DeviceType = "Over-Ear" | "On-Ear" | "IEM";

export type DriverType =
 | "Dynamic"
 | "Planar"
 | "Balanced Armature"
 | "Electrostatic"
 | "Hybrid"
 | "Tribrid";

export type TubeBadgeValue = "Yes" | "OTL Only" | "Transformer Only" | "No";

export type DriveDifficulty = "Easy" | "Moderate" | "Demanding";

export type SoundSignature =
 | "Neutral"
 | "Warm"
 | "V-Shaped"
 | "Bright"
 | "Harman"
 | "Dark";

export type ConnectorType =
 | "3.5mm jack"
 | "2.5mm jack"
 | "4.4mm Pentaconn"
 | "6.35mm jack"
 | "XLR"
 | "Mini-XLR";

export type PeqType = "PK" | "LSC" | "HSC";

export interface PeqBand {
 type: PeqType;
 freq_hz: number;
 gain_db: number;
 /** Required for PK and LSC, blank for HSC. */
 q: number;
}

export interface CustomField {
 key: string;
 value: string;
}

export interface Device {
 id: string;
 brand: string;
 model: string;
 type: DeviceType;
 color: string | null;
 manufacturer_url: string | null;
 webshop_url: string | null;
 image_path: string | null;
 mood_image_path: string | null;
 price: number | null;
 purchase_date: string | null;
 driver_type: DriverType | null;
 impedance_ohms: number | null;
 sensitivity_db: number | null;
 connector_type: ConnectorType | null;
 tube_amp_suitable: TubeBadgeValue | null;
 drive_difficulty: DriveDifficulty | null;
 sound_signature: SoundSignature | null;
 soundstage_rating: number | null;
 /**
  * User's overall rating in 0.5 steps (0.5–5). Stored as 2× the value in
  * the database (`overall_rating` INTEGER); `null` = unrated.
  */
 overall_rating: number | null;
 listening_notes: string | null;
 fr_graph_path: string | null;
 peq_settings: PeqBand[];
 /**
  * Provenance of the PEQ bands, shown with the graph. E.g.
  * `"OPRA · AutoEQ — Harman Target"` or `"Imported: preset.xml"`. OPRA
  * content is CC BY-SA, so attribution is persisted, not just displayed.
  */
 peq_source: string | null;
 custom_fields: CustomField[];
 created_at: string;
}

export const DEVICE_TYPES: DeviceType[] = ["Over-Ear", "On-Ear", "IEM"];

export const DRIVER_TYPES: DriverType[] = [
 "Dynamic",
 "Planar",
 "Balanced Armature",
 "Electrostatic",
 "Hybrid",
 "Tribrid",
];

export const TUBE_BADGES: TubeBadgeValue[] = [
 "Yes",
 "OTL Only",
 "Transformer Only",
 "No",
];

/**
 * User-facing display labels for the stored values. The database keeps
 * the short codes (Yes / OTL Only / Transformer Only / No); these
 * friendlier names are what the UI renders.
 */
export const DRIVE_DIFFICULTIES: DriveDifficulty[] = [
 "Easy",
 "Moderate",
 "Demanding",
];

export const SOUND_SIGNATURES: SoundSignature[] = [
 "Neutral",
 "Warm",
 "V-Shaped",
 "Bright",
 "Harman",
 "Dark",
];

export const CONNECTOR_TYPES: ConnectorType[] = [
 "3.5mm jack",
 "2.5mm jack",
 "4.4mm Pentaconn",
 "6.35mm jack",
 "XLR",
 "Mini-XLR",
];
