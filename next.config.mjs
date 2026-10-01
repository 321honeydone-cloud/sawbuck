/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Load pdfjs-dist natively at runtime (Node-only ESM) instead of bundling it.
  serverExternalPackages: ["pdfjs-dist"],
  // Don't let lint warnings block the production build for this personal tool.
  eslint: { ignoreDuringBuilds: true },
  // Put page metadata (install manifest, icons, theme color) in <head> for every
  // browser. Next 15.5 otherwise streams it into the body, where Chrome never
  // finds the manifest, so the app would not be installable.
  htmlLimitedBots: /.*/,
  // Runtime-written files under /public aren't reliably served by Next's static
  // handler, so route every /uploads/* request through the media API, which
  // streams the file from disk. Covers both old stored URLs and new uploads.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/uploads/:path*", destination: "/api/media/:path*" }],
    };
  },
};

export default nextConfig;
