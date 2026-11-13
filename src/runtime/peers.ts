/**
 * Peer loading: a URL whose last path segment is the published network name.
 *
 * The manifest is fetched from the derived site base, the entry is matched exactly,
 * and the network is validated before anything runs. No publisher code is executed.
 */
import { resolveNetworkEntry, validateManifest, validateNetwork } from './validate'
import type { AgentManifest, LoadedPeer, NetworkDef, PeerLoader } from './types'

export interface PeerLoaderOptions {
  fetchImpl?: typeof fetch
  onOrigin?: (origin: string, purpose: string) => void
}

export function createPeerLoader(opts: PeerLoaderOptions = {}): PeerLoader {
  const doFetch = opts.fetchImpl ?? ((...args) => fetch(...args))

  return {
    async load(url: string): Promise<LoadedPeer> {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new Error(`"${url}" is not an absolute http(s) URL`)
      }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('peer URLs must be http(s)')
      if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1' && parsed.protocol !== 'https:') {
        throw new Error('production peer URLs must use https')
      }

      const base = parsed.origin + parsed.pathname.replace(/\/[^/]+\/?$/, '/')
      const networkName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '')
      const manifestUrl = new URL('agent-manifest.json', base).toString()

      opts.onOrigin?.(parsed.origin, 'peer manifest')
      const manifestRaw = await getJson(doFetch, manifestUrl)
      const manifestCheck = validateManifest(manifestRaw)
      if (!manifestCheck.ok) {
        throw new Error(`${manifestUrl} is not a valid manifest: ${manifestCheck.errors.join('; ')}`)
      }
      const manifest = manifestRaw as AgentManifest

      const resolved = resolveNetworkEntry(manifest, networkName, base)
      if (!resolved.ok) throw new Error(resolved.error)

      opts.onOrigin?.(parsed.origin, 'peer network definition')
      const networkRaw = await getJson(doFetch, resolved.entry.url)
      const networkCheck = validateNetwork(networkRaw, resolved.entry.front_man)
      if (!networkCheck.ok) {
        throw new Error(`${resolved.entry.url} is not a valid network: ${networkCheck.errors.join('; ')}`)
      }

      return {
        base,
        origin: parsed.origin,
        networkName: resolved.entry.name,
        frontMan: resolved.entry.front_man,
        manifest,
        network: networkRaw as NetworkDef,
      }
    },
  }
}

async function getJson(doFetch: typeof fetch, url: string): Promise<unknown> {
  let res: Response
  try {
    res = await doFetch(url, { headers: { accept: 'application/json' } })
  } catch (err) {
    throw new Error(
      `could not fetch ${url} (${err instanceof Error ? err.message : String(err)}). ` +
        'A cross-origin peer must publish CORS headers for this origin.',
    )
  }
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  // Some CDNs serve JSON as text/plain; parse the text rather than trusting the type.
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${url} did not contain JSON`)
  }
}
