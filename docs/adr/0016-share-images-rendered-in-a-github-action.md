# Share images are rendered in a GitHub Action into a public R2 bucket

Every page used the single `public/og-image.jpg`, so a shared race or prediction link looked like any
other link. Rendering a card per request is out: satori + resvg as WASM takes far more than Workers Free's
10 ms of CPU. Three ways to render ahead of time were weighed (#93 C):

1. **A GitHub Action** (free on a public repo) reads the public API, renders with satori in Node and
   uploads the PNGs to a public R2 bucket. **Chosen.**
2. The Render ETL renders with Pillow after each ingest and uploads through R2's S3 API. That needs an R2
   secret on Render and memory the 512 MB worker doesn't have to spare.
3. The API Worker streams images from the private snapshot bucket. That adds a route and a Worker request
   for every image view.

`apps/og` holds the renderer, so its native `@resvg/resvg-js` never enters the Pages build. What a card
shows and where it lives (`og/<race|prediction>/<raceId>.png`) is in `apps/web/src/lib/shareImage.ts`, which
both the pages and the renderer import. The workflow (`.github/workflows/og-images.yml`) runs every 3 h from
Friday to Monday. It skips any image already in the bucket, because a result is final and a prediction is
fixed after qualifying, so most runs send only a few HEAD requests. It reads only cached API routes and
never opens a Neon connection.

## Consequences

- Pages point `og:image` at the bucket only once the image should exist: a race once it's `completed`, a
  prediction once it's stored. Between that moment and the next run (at most 3 h) the link has no image.
- Until `PUBLIC_OG_IMAGE_URL` (`apps/web/wrangler.toml`) and the workflow's secrets are set, nothing
  changes: pages keep the default image and the workflow skips itself.
- A redesign needs a forced re-render: run the workflow by hand with `force`.
- Driver pages are left for later.
