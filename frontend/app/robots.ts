import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/utils/siteUrl";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        disallow: ["/"],
        allow: ["/pv", "/docs", "/termos-de-uso", "/politica-de-privacidade", "/exclusao-de-dados"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

