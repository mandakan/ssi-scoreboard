import { MetadataRoute } from "next";
import { headers } from "next/headers";

const STAGING_HOSTS = new Set([
  "ssi-scoreboard-staging.long-sun-fac0.workers.dev",
]);

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headersList = await headers();
  const host = headersList.get("host") ?? "";

  if (STAGING_HOSTS.has(host)) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
  };
}
