const STORAGE_PUBLIC_PATH = "/storage/v1/object/public/";
const STORAGE_BUCKET = "ad-thumbs";

function isStoragePublicUrl(value: unknown): value is string {
  const url = String(value || "").trim();
  if (!url) return false;
  return url.includes(STORAGE_PUBLIC_PATH);
}

function buildStorageUrlFromPath(path: unknown): string | null {
  const storagePath = String(path || "").trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!storagePath || !supabaseUrl) return null;

  const encodedPath = storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${STORAGE_BUCKET}/${encodedPath}`;
}

export function getFacebookAvatarUrl(connection: any): string | null {
  const storageUrl = buildStorageUrlFromPath(connection?.picture_storage_path);
  if (storageUrl) return storageUrl;

  const directUrl = String(connection?.facebook_picture_url || "").trim();
  if (!directUrl) return null;
  if (!isStoragePublicUrl(directUrl)) return null;
  return directUrl;
}
