import exifr from "exifr";

export type MediaInfoPayload = {
  caption: string | null;
  description: string | null;
  taken_at: string | null;
  taken_at_source: string | null;
  uploaded_at: string;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  mime_type: string;
  filename: string;
  megapixels: number | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  camera_name: string | null;
  aperture: string | null;
  exposure_time: string | null;
  focal_length: string | null;
  iso: number | null;
  upload_source: string;
  timezone: string | null;
  specs_line: string | null;
  size_label: string | null;
  dimensions_label: string | null;
};

type ExifRecord = Record<string, unknown>;

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function formatAperture(fNumber: number | null): string | null {
  if (fNumber == null) return null;
  const rounded = Math.round(fNumber * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `f/${text}`;
}

function formatExposure(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  if (seconds >= 1) {
    const rounded = Math.round(seconds * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
  }
  const denom = Math.max(1, Math.round(1 / seconds));
  return `1/${denom}`;
}

function formatFocalLength(mm: number | null): string | null {
  if (mm == null) return null;
  const rounded = Math.round(mm * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}mm`;
}

function formatBytes(bytes: number | null): string | null {
  if (bytes == null || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb * 10) / 10} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatMegapixels(width: number | null, height: number | null): number | null {
  if (!width || !height) return null;
  return Math.round((width * height) / 1_000_000 * 10) / 10;
}

function cameraName(exif: ExifRecord | null): string | null {
  if (!exif) return null;
  const make = asString(exif.Make);
  const model = asString(exif.Model);
  if (make && model) {
    if (model.toLowerCase().startsWith(make.toLowerCase())) return model;
    return `${make} ${model}`;
  }
  return model || make;
}

function timezoneFromExif(exif: ExifRecord | null): string | null {
  if (!exif) return null;
  const offset =
    asString(exif.OffsetTimeOriginal) ||
    asString(exif.OffsetTime) ||
    asString(exif.OffsetTimeDigitized);
  if (!offset) return null;
  // EXIF offsets look like "+07:00" / "-05:00"
  if (/^[+-]\d{2}:\d{2}$/.test(offset)) return `GMT${offset}`;
  return offset;
}

function takenAtFromExif(exif: ExifRecord | null): string | null {
  if (!exif) return null;
  const raw =
    exif.DateTimeOriginal ??
    exif.CreateDate ??
    exif.DateTimeDigitized ??
    exif.ModifyDate;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    // Common EXIF: "2024:04:13 19:44:00"
    const normalized = raw.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
    const d = new Date(normalized);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export function extractExifFields(exif: ExifRecord | null) {
  const aperture = formatAperture(asNumber(exif?.FNumber ?? exif?.ApertureValue));
  const exposure_time = formatExposure(asNumber(exif?.ExposureTime));
  const focal_length = formatFocalLength(
    asNumber(exif?.FocalLengthIn35mmFormat) ?? asNumber(exif?.FocalLength),
  );
  const iso = asNumber(exif?.ISO ?? exif?.ISOSpeedRatings ?? exif?.PhotographicSensitivity);
  const latitude = asNumber(exif?.latitude);
  const longitude = asNumber(exif?.longitude);
  const specs = [aperture, exposure_time, focal_length, iso != null ? `ISO${iso}` : null]
    .filter(Boolean)
    .join(" ");

  return {
    camera_name: cameraName(exif),
    aperture,
    exposure_time,
    focal_length,
    iso,
    latitude,
    longitude,
    timezone: timezoneFromExif(exif),
    taken_at_exif: takenAtFromExif(exif),
    specs_line: specs || null,
    width_exif: asNumber(exif?.ExifImageWidth ?? exif?.ImageWidth),
    height_exif: asNumber(exif?.ExifImageHeight ?? exif?.ImageHeight),
  };
}

export async function parseExifFromBytes(
  bytes: Uint8Array,
): Promise<ExifRecord | null> {
  try {
    const parsed = await exifr.parse(bytes, {
      tiff: true,
      exif: true,
      gps: true,
      interop: false,
      ifd1: false,
      translateKeys: true,
      translateValues: true,
      reviveValues: true,
      sanitize: true,
      mergeOutput: true,
    });
    if (!parsed || typeof parsed !== "object") return null;
    // Drop non-JSON-safe values before caching.
    return JSON.parse(
      JSON.stringify(parsed, (_key, value) => {
        if (value instanceof Date) return value.toISOString();
        if (typeof value === "bigint") return Number(value);
        if (typeof value === "number" && !Number.isFinite(value)) return null;
        return value;
      }),
    ) as ExifRecord;
  } catch {
    return null;
  }
}

export function buildMediaInfo(input: {
  caption: string | null;
  alt_text: string | null;
  taken_at: string | null;
  taken_at_source: string | null;
  uploaded_at: string;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  mime_type: string;
  filename: string;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  client_local_id: string | null;
  exif: ExifRecord | null;
}): MediaInfoPayload {
  const extracted = extractExifFields(input.exif);
  const width = input.width ?? extracted.width_exif;
  const height = input.height ?? extracted.height_exif;
  const megapixels = formatMegapixels(width, height);
  const size_label = formatBytes(input.byte_size);
  const dimensions_label =
    width && height
      ? `${megapixels != null ? `${megapixels}MP ` : ""}${width} × ${height}`.trim()
      : null;

  const latitude = input.latitude ?? extracted.latitude;
  const longitude = input.longitude ?? extracted.longitude;

  return {
    caption: input.caption,
    description: input.alt_text,
    taken_at: input.taken_at || extracted.taken_at_exif,
    taken_at_source: input.taken_at_source,
    uploaded_at: input.uploaded_at,
    width,
    height,
    byte_size: input.byte_size,
    mime_type: input.mime_type,
    filename: input.filename,
    megapixels,
    location_name: input.location_name,
    latitude,
    longitude,
    camera_name: extracted.camera_name,
    aperture: extracted.aperture,
    exposure_time: extracted.exposure_time,
    focal_length: extracted.focal_length,
    iso: extracted.iso,
    upload_source: input.client_local_id
      ? "Uploaded from device"
      : "Uploaded from web",
    timezone: extracted.timezone,
    specs_line: extracted.specs_line,
    size_label,
    dimensions_label,
  };
}
