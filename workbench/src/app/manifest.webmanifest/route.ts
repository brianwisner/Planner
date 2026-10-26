export function GET() {
  const manifest = {
    name: "Wisner Workbench",
    short_name: "Workbench",
    description: "Planning, scheduling, estimates, and time for Wisner Engineering, LLC",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    background_color: "#f6f6f4",
    theme_color: "#0f6e6a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}
