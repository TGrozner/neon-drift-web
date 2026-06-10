import { describe, expect, it } from 'vitest'
import collector from '../worker/diagnostics-collector'

type StoredValue = {
  value: string
}

function createStore() {
  const values = new Map<string, StoredValue>()
  return {
    async get(key: string) {
      return values.get(key)?.value ?? null
    },
    async put(key: string, value: string) {
      values.set(key, { value })
    },
    async list(options?: { prefix?: string; limit?: number }) {
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? 1000
      return {
        keys: [...values.keys()]
          .filter((key) => key.startsWith(prefix))
          .slice(0, limit)
          .map((name) => ({ name })),
      }
    },
  }
}

function payload() {
  return {
    version: 1,
    reason: 'test',
    session: {
      id: 'session-test',
      startedAt: '2026-06-10T10:00:00.000Z',
      environment: {
        href: 'https://tgrozner.github.io/neon-drift-web/',
        userAgent: 'vitest',
      },
    },
    entries: [
      {
        id: 1,
        sessionId: 'session-test',
        timestamp: Date.now(),
        isoTime: new Date().toISOString(),
        elapsedMs: 1,
        level: 'warn',
        category: 'mobile',
        message: 'slow_frame',
      },
    ],
  }
}

describe('diagnostics collector worker', () => {
  it('stores production batches and protects read access', async () => {
    const env = {
      LOGS: createStore(),
      READ_TOKEN: 'secret',
      ALLOWED_ORIGINS: 'https://tgrozner.github.io',
    }

    const ingest = await collector.fetch(new Request('https://logs.example.test/collect', {
      method: 'POST',
      headers: {
        Origin: 'https://tgrozner.github.io',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload()),
    }), env)

    expect(ingest.status).toBe(202)

    const blocked = await collector.fetch(new Request('https://logs.example.test/sessions'), env)
    expect(blocked.status).toBe(401)

    const sessions = await collector.fetch(new Request('https://logs.example.test/sessions', {
      headers: { Authorization: 'Bearer secret' },
    }), env)
    const body = await sessions.json() as { sessions: Array<{ sessionId: string; levelCounts: { warn: number } }> }
    expect(body.sessions[0].sessionId).toBe('session-test')
    expect(body.sessions[0].levelCounts.warn).toBe(1)
  })

  it('rejects unknown browser origins', async () => {
    const env = {
      LOGS: createStore(),
      READ_TOKEN: 'secret',
      ALLOWED_ORIGINS: 'https://tgrozner.github.io',
    }

    const response = await collector.fetch(new Request('https://logs.example.test/collect', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      body: JSON.stringify(payload()),
    }), env)

    expect(response.status).toBe(403)
  })
})
