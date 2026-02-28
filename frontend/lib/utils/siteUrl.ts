const DEFAULT_SITE_URL = "https://hookifyads.com";

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return DEFAULT_SITE_URL;

  const withProtocol = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (envUrl) return normalizeUrl(envUrl);

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return normalizeUrl(vercelUrl);

  return DEFAULT_SITE_URL;
}

export function getSiteOrigin(): URL {
  return new URL(getSiteUrl());
}

