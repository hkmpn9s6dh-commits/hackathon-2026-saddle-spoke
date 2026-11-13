/**
 * Bring-your-own-key inference through an OpenAI-compatible router.
 *
 * The key lives in this origin's localStorage, is attached only to requests sent to the
 * router the visitor chose, and is never put in a URL, a manifest, a prompt, an action
 * argument, a trace, or a peer request.
 */
import type { ModelMessage, ModelProvider, ModelTurn } from './types'

export interface ByokProfile {
  baseUrl: string
  model: string
  apiKey: string
}

const STORAGE_KEY = 'saddle-and-spoke/byok/v1'

export function loadProfile(storage: Storage | null = globalThis.localStorage ?? null): ByokProfile | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as ByokProfile
    if (!p.baseUrl || !p.model) return null
    return p
  } catch {
    return null
  }
}

export function saveProfile(p: ByokProfile, storage: Storage | null = globalThis.localStorage ?? null): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify(p))
}

export function clearProfile(storage: Storage | null = globalThis.localStorage ?? null): void {
  storage?.removeItem(STORAGE_KEY)
}

export function createByokProvider(
  profile: ByokProfile,
  opts: { fetchImpl?: typeof fetch; onOrigin?: (origin: string, purpose: string) => void } = {},
): ModelProvider {
  const doFetch = opts.fetchImpl ?? ((...args) => fetch(...args))
  const base = profile.baseUrl.replace(/\/+$/, '')

  return {
    id: 'byok',
    label: `BYOK · ${profile.model}`,
    networked: true,
    async chat({ system, messages, tools }): Promise<ModelTurn> {
      const url = `${base}/chat/completions`
      const origin = new URL(base).origin
      opts.onOrigin?.(origin, 'model request')

      const body = {
        model: profile.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          ...messages.map(toWire),
        ],
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: 'auto',
      }

      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${profile.apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`the router answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
      }

      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null
            tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
          }
        }>
      }
      const message = data.choices?.[0]?.message
      if (!message) throw new Error('the router returned no message')

      const calls = (message.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        args: safeParse(c.function.arguments),
      }))

      return { text: message.content ?? '', toolCalls: calls }
    },
  }
}

function toWire(m: ModelMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId ?? m.name ?? 'call', content: m.content }
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    }
  }
  return { role: m.role, content: m.content }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
