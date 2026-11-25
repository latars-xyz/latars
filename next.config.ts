import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  // latars.xyz itself is the static landing page in /public; "/" serves it. Everything else here is the admin.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/index.html" }], afterFiles: [], fallback: [] };
  },
  async redirects() {
    // The admin used to live at /admin as well; old bookmarks land on the current one.
    return [{ source: "/admin", destination: "/adminx", permanent: true }];
  },
  experimental: { serverActions: { bodySizeLimit: "4mb", allowedOrigins: ["latars.xyz", "www.latars.xyz"] } },
  poweredByHeader: false,
};

export default nextConfig;
