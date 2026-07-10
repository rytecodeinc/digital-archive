/** Opaque URL-safe public id (≈43 chars), similar to Google Photos share ids. */
export function newPublicId() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function isPublicId(value: string) {
  return /^[A-Za-z0-9_-]{20,64}$/.test(value);
}
