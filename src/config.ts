/**
 * Where the peer network lives.
 *
 * In production the supplier's bundle is served from a different origin (a CDN), which
 * is what makes "load a second site's agents" a real cross-origin load. On localhost we
 * point at our own copy so the page can be developed and tested offline.
 */
const PROD_PEER =
  'https://cdn.jsdelivr.net/gh/hkmpn9s6dh-commits/hackathon-2026-saddle-spoke@gh-pages/peer/bellwether_parts'

export const IS_LOCAL =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:'

export const PEER_URL = IS_LOCAL ? new URL('peer/bellwether_parts', location.href).toString() : PROD_PEER
