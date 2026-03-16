import { supabase } from './supabase.js'

// 2026 NCAA Tournament dates (including Play-In)
const TOURNAMENT_DATES = [
  '20260317', '20260318', // First Four / Play-In
  '20260319', '20260320', // Round of 64
  '20260321', '20260322', // Round of 32
  '20260326', '20260327', // Sweet Sixteen
  '20260328', '20260329', // Elite Eight
  '20260404',              // Final Four
  '20260406',              // Championship
]

const ESPN_ROUND_MAP = {
  'first four': 'Play-In',
  'first round': 'Round of 64',
  'second round': 'Round of 32',
  'sweet sixteen': 'Sweet Sixteen',
  'sweet 16': 'Sweet Sixteen',
  'elite eight': 'Elite Eight',
  'elite 8': 'Elite Eight',
  'final four': 'Final Four',
  'national championship': 'Championship',
  'championship': 'Championship',
}

function normalizeRoundName(espnNote) {
  if (!espnNote) return null
  const lower = espnNote.toLowerCase()
  for (const [key, val] of Object.entries(ESPN_ROUND_MAP)) {
    if (lower.includes(key)) return val
  }
  return null
}

function normalizeName(name) {
  return name.toLowerCase().trim().replace(/[^a-z\s]/g, '')
}

// Get today's date string YYYYMMDD
function todayStr() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

async function fetchEventsForDate(dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=50`
  try {
    const res = await fetch(url)
    const data = await res.json()
    return data.events || []
  } catch {
    return []
  }
}

async function fetchGameSummary(eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${eventId}`
  try {
    const res = await fetch(url)
    return await res.json()
  } catch {
    return null
  }
}

function parsePlayerPointsFromSummary(summary, roundName) {
  const results = {}
  if (!summary?.boxscore?.players) return results

  for (const teamData of summary.boxscore.players) {
    for (const statGroup of teamData.statistics || []) {
      const names = statGroup.names || []
      const ptsIndex = names.indexOf('PTS')
      if (ptsIndex === -1) continue

      for (const athlete of statGroup.athletes || []) {
        const displayName = athlete.athlete?.displayName
        const ptsStr = athlete.stats?.[ptsIndex]
        const pts = parseInt(ptsStr, 10)
        if (displayName && !isNaN(pts)) {
          results[displayName] = { points: pts, roundName }
        }
      }
    }
  }

  return results
}

function findBestNameMatch(ourName, espnNames) {
  const normalized = normalizeName(ourName)

  // 1. Exact match
  for (const en of espnNames) {
    if (normalizeName(en) === normalized) return en
  }

  // 2. Last name + first initial
  const parts = normalized.split(' ')
  const lastName = parts[parts.length - 1]
  const firstInitial = parts[0]?.[0]
  const candidates = espnNames.filter(en => {
    const n = normalizeName(en)
    return n.includes(lastName) && n.startsWith(firstInitial)
  })
  if (candidates.length === 1) return candidates[0]

  // 3. Last name only (only if unique)
  const lastNameOnly = espnNames.filter(en => normalizeName(en).includes(lastName))
  if (lastNameOnly.length === 1) return lastNameOnly[0]

  return null
}

export async function syncTournamentScores(onProgress) {
  const today = todayStr()
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= today)

  if (datesToFetch.length === 0) {
    return { matched: [], unmatched: [], message: 'Tournament has not started yet.' }
  }

  onProgress?.(`Fetching games for ${datesToFetch.length} tournament date(s)...`)

  // Collect all player stats across all completed games
  // Map: espnPlayerName -> { roundName, points }[]
  const allStats = {}

  for (const dateStr of datesToFetch) {
    const events = await fetchEventsForDate(dateStr)

    for (const event of events) {
      const status = event.status?.type?.completed
      if (!status) continue // game not finished

      const noteHeadline = event.notes?.[0]?.headline
      const roundName = normalizeRoundName(noteHeadline)
      if (!roundName) continue // not a recognized tournament round

      onProgress?.(`Fetching box score: ${event.shortName || event.id} (${roundName})`)
      const summary = await fetchGameSummary(event.id)
      if (!summary) continue

      const gamePlayers = parsePlayerPointsFromSummary(summary, roundName)
      for (const [name, stats] of Object.entries(gamePlayers)) {
        if (!allStats[name]) allStats[name] = []
        // Avoid duplicate entries for same player/round
        const exists = allStats[name].some(s => s.roundName === stats.roundName)
        if (!exists) allStats[name].push(stats)
      }
    }
  }

  const espnNames = Object.keys(allStats)
  onProgress?.(`Found stats for ${espnNames.length} players. Matching to your draft...`)

  // Get all drafted players
  const { data: draftedPlayers, error } = await supabase
    .from('players')
    .select('id, name')
    .not('drafter_id', 'is', null)

  if (error) throw new Error('Failed to fetch players from DB: ' + error.message)

  const matched = []
  const unmatched = []

  for (const player of draftedPlayers) {
    const espnName = findBestNameMatch(player.name, espnNames)

    if (espnName) {
      const statsToWrite = allStats[espnName]
      for (const { roundName, points } of statsToWrite) {
        await supabase.from('player_scores').upsert(
          { player_id: player.id, round_name: roundName, points, updated_at: new Date().toISOString() },
          { onConflict: 'player_id,round_name' }
        )
      }
      matched.push({ ourName: player.name, espnName })
    } else {
      unmatched.push(player.name)
    }
  }

  // Save last sync timestamp
  await supabase.from('settings').upsert({ key: 'last_espn_sync', value: new Date().toISOString() })

  return { matched, unmatched }
}
