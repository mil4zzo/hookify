import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/utils/siteUrl";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  const routes = ["/pv", "/docs", "/termos-de-uso", "/politica-de-privacidade", "/exclusao-de-dados"];

  return routes.map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified,
  }));
}

