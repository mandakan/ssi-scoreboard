import { MetadataRoute } from "next";

const BASE_URL = "https://scoreboard.urdr.dev";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/about`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/legal`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
