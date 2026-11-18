// Set per build in astro.config.mjs. Cached pages hold for up to a day and link this build's
// hashed assets, so a deploy must start a fresh set of copies.
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
