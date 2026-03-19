// Standalone ESPN sync script — runs via GitHub Actions every 15 min on game days
// Mirrors the logic in src/lib/espnSync.js but uses Node + service role key

import { createClient } from '@supabase/supabase-js'
import fetch from 'node-fetch'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars')
  process.exit(1)
}

// Use service role key (not anon key) — safe since this runs server-side only
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Tournament game days (ET dates) ─────────────────────────────────────────
const GAME_DAYS = new Set([
  '2026-03-17', '2026-03-18', // Play-In
  '2026-03-19', '2026-03-20', // Round of 64
  '2026-03-21', '2026-03-22', // Round of 32
  '2026-03-26', '2026-03-27', // Sweet Sixteen
  '2026-03-28', '2026-03-29', // Elite Eight
  '2026-04-04',               // Final Four
  '2026-04-06',               // Championship
])

const TOURNAMENT_DATES = [
  '20260317', '20260318',
  '20260319', '20260320',
  '20260321', '20260322',
  '20260326', '20260327',
  '20260328', '20260329',
  '20260404',
  '20260406',
]

const DATE_TO_ROUND = {
  '20260317': 'Play-In',   '20260318': 'Play-In',
  '20260319': 'Round of 64', '20260320': 'Round of 64',
  '20260321': 'Round of 32', '20260322': 'Round of 32',
  '20260326': 'Sweet Sixteen', '20260327': 'Sweet Sixteen',
  '20260328': 'Elite Eight', '20260329': 'Elite Eight',
  '20260404': 'Final Four',
  '20260406': 'Championship',
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`) }

function todayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

function todayStr() {
  return todayET().replace(/-/g, '')
}

function extractParts(name) {
  const parts = name.toLowerCase().trim()
    .replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ')
    .split(' ').filter(p => p && !SUFFIXES.has(p))
  return { first: parts[0] || '', last: parts[parts.length - 1] || '', full: parts.join(' ') }
}

function teamsMatch(a, b) {
  if (!a || !b) return false
  const n = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const na = n(a), nb = n(b)
  return na === nb || na.includes(nb) || nb.includes(na)
}

function findByEspnId(espnPlayerId, espnIdMap) {
  if (!espnPlayerId) return null
  for (const [name, id] of Object.entries(espnIdMap)) {
    if (id === espnPlayerId) return name
  }
  return null
}

function findBestNameMatch(ourName, ourTeam, allStats) {
  const our = extractParts(ourName)
  const espnNames = Object.keys(allStats)

  for (const en of espnNames) {
    if (extractParts(en).full === our.full && teamsMatch(ourTeam, allStats[en][0]?.espnTeam)) return en
  }
  for (const en of espnNames) {
    if (extractParts(en).full === our.full) return en
  }
  for (const en of espnNames) {
    const ep = extractParts(en)
    if (ep.last === our.last && our.first.length > 0 && ep.first[0] === our.first[0]
        && teamsMatch(ourTeam, allStats[en][0]?.espnTeam)) return en
  }
  for (const en of espnNames) {
    const ep = extractParts(en)
    if (ep.last === our.last && our.first.length > 0 && ep.first[0] === our.first[0]
        && !allStats[en][0]?.espnTeam) return en
  }
  return null
}

function isTournamentGame(event) {
  const comp = event.competitions?.[0]
  if (!comp?.neutralSite) return false
  if (event.season?.type === 3 || event.season?.type === '3') return true
  const groupName = (event.groups?.name || '').toLowerCase()
  if (groupName.includes('ncaa') || groupName.includes('tournament')) return true
  const headline = (event.notes?.[0]?.headline || comp?.notes?.[0]?.headline || '').toLowerCase()
  return ['ncaa','tournament','first four','first round','second round',
          'sweet','elite','final four','championship'].some(k => headline.includes(k))
}

function detectRoundName(event, dateStr) {
  const comp = event.competitions?.[0]
  const candidates = [
    event.notes?.[0]?.headline, comp?.notes?.[0]?.headline,
    event.name, event.shortName, comp?.type?.text,
  ].filter(Boolean).map(s => s.toLowerCase())

  const ROUND_MAP = [
    { patterns: ['first four','play-in','opening round'], round: 'Play-In' },
    { patterns: ['first round','round of 64'],            round: 'Round of 64' },
    { patterns: ['second round','round of 32'],           round: 'Round of 32' },
    { patterns: ['sweet sixteen','sweet 16'],             round: 'Sweet Sixteen' },
    { patterns: ['elite eight','elite 8'],                round: 'Elite Eight' },
    { patterns: ['final four'],                           round: 'Final Four' },
    { patterns: ['national championship','championship'], round: 'Championship' },
  ]

  for (const { patterns, round } of ROUND_MAP) {
    for (const c of candidates) {
      if (patterns.some(p => c.includes(p))) return round
    }
  }

  if (isTournamentGame(event)) return DATE_TO_ROUND[dateStr] || null
  return null
}

function parsePlayerPoints(summary, roundName) {
  const results = {}
  if (!summary?.boxscore?.players) return results

  for (const teamData of summary.boxscore.players) {
    const espnTeamName = teamData.team?.displayName || teamData.team?.name || ''
    for (const statGroup of teamData.statistics || []) {
      const ptsIndex = (statGroup.names || []).indexOf('PTS')
      if (ptsIndex === -1) continue
      for (const athlete of statGroup.athletes || []) {
        const name = athlete.athlete?.displayName
        const espnId = athlete.athlete?.id ? String(athlete.athlete.id) : null
        const pts = parseInt(athlete.stats?.[ptsIndex], 10)
        if (name && !isNaN(pts)) {
          if (!results[name] || pts > results[name].points) {
            results[name] = { points: pts, roundName, espnTeam: espnTeamName, espnId }
          }
        }
      }
    }
  }
  return results
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url)
    return await res.json()
  } catch { return null }
}

async function main() {
  const today = todayET()
  log(`Running sync — today is ${today} ET`)

  if (!GAME_DAYS.has(today)) {
    log(`Not a game day — skipping sync`)
    process.exit(0)
  }

  const todayDateStr = todayStr()
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= todayDateStr)
  log(`Fetching ${datesToFetch.length} date(s)...`)

  const allStats = {}
  const espnIdMap = {}
  const completedEvents = []

  for (const dateStr of datesToFetch) {
    const data = await fetchJSON(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`
    )
    const events = data?.events || []
    log(`${dateStr}: ${events.length} event(s)`)

    for (const event of events) {
      if (!event.status?.type?.completed) continue
      const roundName = detectRoundName(event, dateStr)
      event._tournamentRound = roundName || null
      completedEvents.push(event)
      if (!roundName) continue

      const summary = await fetchJSON(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${event.id}`
      )
      if (!summary) continue

      const gamePlayers = parsePlayerPoints(summary, roundName)
      for (const [name, stats] of Object.entries(gamePlayers)) {
        if (!allStats[name]) allStats[name] = []
        if (!allStats[name].some(s => s.roundName === stats.roundName)) {
          allStats[name].push({ points: stats.points, roundName: stats.roundName, espnTeam: stats.espnTeam })
        }
        if (stats.espnId) espnIdMap[name] = stats.espnId
      }
    }
  }

  log(`Found stats for ${Object.keys(allStats).length} players across ${completedEvents.length} games`)

  // Auto-eliminate losers
  const losingTeams = new Set()
  for (const event of completedEvents) {
    if (!event._tournamentRound) continue
    for (const c of event.competitions?.[0]?.competitors || []) {
      if (c.winner === false) {
        const name = c.team?.displayName || c.team?.name || ''
        if (name) losingTeams.add(name.toLowerCase())
      }
    }
  }

  if (losingTeams.size > 0) {
    const { data: activePlayers } = await supabase
      .from('players').select('id, name, team').eq('is_eliminated', false)

    const toEliminate = (activePlayers || []).filter(p => {
      const team = p.team.toLowerCase()
      for (const loser of losingTeams) {
        if (loser.includes(team) || team.includes(loser.split(' ')[0])) return true
      }
      return false
    })

    if (toEliminate.length > 0) {
      await supabase.from('players').update({ is_eliminated: true })
        .in('id', toEliminate.map(p => p.id))
      log(`Auto-eliminated: ${toEliminate.map(p => p.name).join(', ')}`)
    }
  }

  // Match and write scores
  const { data: draftedPlayers } = await supabase
    .from('players').select('id, name, team, espn_player_id')
    .not('drafter_id', 'is', null)

  let matched = 0, unmatched = []

  for (const player of draftedPlayers || []) {
    let espnName = player.espn_player_id
      ? findByEspnId(player.espn_player_id, espnIdMap)
      : null

    const matchedByName = !espnName
    if (!espnName) espnName = findBestNameMatch(player.name, player.team, allStats)

    if (espnName) {
      if (matchedByName && !player.espn_player_id && espnIdMap[espnName]) {
        await supabase.from('players')
          .update({ espn_player_id: espnIdMap[espnName] }).eq('id', player.id)
        log(`Saved ESPN ID ${espnIdMap[espnName]} → ${player.name}`)
      }

      for (const { roundName, points } of allStats[espnName]) {
        await supabase.from('player_scores').upsert(
          { player_id: player.id, round_name: roundName, points, updated_at: new Date().toISOString() },
          { onConflict: 'player_id,round_name' }
        )
      }
      matched++
    } else {
      unmatched.push(player.name)
    }
  }

  await supabase.from('settings').upsert({ key: 'last_espn_sync', value: new Date().toISOString() })

  log(`Matched: ${matched} | Unmatched: ${unmatched.length}`)
  if (unmatched.length > 0) log(`Unmatched: ${unmatched.join(', ')}`)
  log('Sync complete')
}

main().catch(err => { console.error(err); process.exit(1) })
