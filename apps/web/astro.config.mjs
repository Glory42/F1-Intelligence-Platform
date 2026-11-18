import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Cloudflare Pages sets the commit for every build; a local build gets its build time.
const BUILD_ID = (process.env.CF_PAGES_COMMIT_SHA ?? Date.now().toString(36)).slice(0, 12);

export default defineConfig({
  site: "https://f1.gorkemkaryol.dev",
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
  }),
  integrations: [react(), sitemap({
    // The data-quality dashboard is dev-only (404 in production) and robots.txt disallows /compare/.
    filter: (page) => !page.includes('/health-quality/') && !page.includes('/compare/'),
    // Detail pages aren't known at build time: src/pages/sitemap-dynamic.xml.ts lists them per request.
    customSitemaps: ["https://f1.gorkemkaryol.dev/sitemap-dynamic.xml"],
  })],
  vite: {
    define: {
      __BUILD_ID__: JSON.stringify(BUILD_ID),
    },
    // Workers provide it under nodejs_compat (wrangler.toml); lib/renderHealth.ts tracks each render with it.
    ssr: {
      external: ["node:async_hooks"],
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react/jsx-runtime"],
    },

    server: {
      fs: {
        // Allow loading files from the monorepo root (e.g. docs/ for content collections)
        allow: ["../.."],
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  },
});
