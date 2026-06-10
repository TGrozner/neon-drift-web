#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'

const localEnv = readLocalEnv()
const endpoint = normalizeEndpoint(
  process.env.DIAGNOSTICS_ENDPOINT ??
  process.env.VITE_DIAGNOSTICS_ENDPOINT ??
  localEnv.DIAGNOSTICS_ENDPOINT ??
  localEnv.VITE_DIAGNOSTICS_ENDPOINT,
)
const token = process.env.DIAGNOSTICS_READ_TOKEN ?? localEnv.DIAGNOSTICS_READ_TOKEN
const command = process.argv[2] ?? 'sessions'
const value = process.argv[3]

if (!endpoint || !token) {
  console.error('Missing DIAGNOSTICS_ENDPOINT/VITE_DIAGNOSTICS_ENDPOINT or DIAGNOSTICS_READ_TOKEN.')
  console.error('Example: DIAGNOSTICS_ENDPOINT=https://neon-drift-diagnostics.<subdomain>.workers.dev/collect DIAGNOSTICS_READ_TOKEN=... npm run logs:prod')
  process.exit(1)
}

const path = command === 'session'
  ? `/sessions/${encodeURIComponent(required(value, 'session id'))}/batches`
  : '/sessions'

const response = await fetch(`${endpoint.origin}${path}`, {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  },
})

const text = await response.text()
if (!response.ok) {
  console.error(`Diagnostics request failed: ${response.status} ${response.statusText}`)
  console.error(text)
  process.exit(1)
}

const data = JSON.parse(text)
if (command === 'session') {
  printBatches(data)
} else {
  printSessions(data)
}

function normalizeEndpoint(raw) {
  if (!raw) return null
  const url = new URL(raw)
  if (url.pathname === '/') url.pathname = '/collect'
  return url
}

function readLocalEnv() {
  const path = '.env.diagnostics.local'
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .flatMap((line) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) return []
        const separatorIndex = trimmed.indexOf('=')
        if (separatorIndex === -1) return []
        const key = trimmed.slice(0, separatorIndex).trim()
        const value = trimmed.slice(separatorIndex + 1).trim()
        return [[key, value]]
      }),
  )
}

function required(input, label) {
  if (input) return input
  console.error(`Missing ${label}.`)
  process.exit(1)
}

function printSessions(data) {
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  if (sessions.length === 0) {
    console.log('No production diagnostics sessions found.')
    return
  }

  for (const session of sessions) {
    const counts = session.levelCounts ?? {}
    console.log([
      session.sessionId,
      `last=${session.lastSeenAt}`,
      `entries=${session.entryCount}`,
      `batches=${session.batchCount}`,
      `warn=${counts.warn ?? 0}`,
      `error=${counts.error ?? 0}`,
      session.latestHref ? `url=${session.latestHref}` : null,
    ].filter(Boolean).join(' | '))
  }
}

function printBatches(data) {
  const batches = Array.isArray(data.batches) ? data.batches : []
  if (batches.length === 0) {
    console.log('No batches found for this session.')
    return
  }

  for (const batch of batches) {
    console.log(JSON.stringify(batch, null, 2))
  }
}
