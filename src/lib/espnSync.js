import { supabase } from './supabase.js'

const TOURNAMENT_DATES = [
  '20260317', '20260318', // First Four / Play-In
  '20260319', '20260320', // Round of 64
  '20260321', '20260322', // Round of 32
  '20260326', '20260327', // Sweet Sixteen
  '20260328', '20260329', // Elite Eight
  '20260404',             // Final Four
  '20260406',             // Championship
]

// Match ESPN round labels to our round names — cast a wide net
const ESPN_ROUND_MAP = [
  { patterns: ['first four', 'first 4', 'opening round', 'play-in', 'play in'],   round: 'Play-In' },
  { patterns: ['first round', 'round of 64', '1st round'],                         round: 'Round of 64' },
  { patterns: ['second round', 'round of 32', '2nd round'],                        round: 'Round of 32' },
  { patterns: ['sweet sixteen', 'sweet 16', 'regional semifinal'],                 round: 'Sweet Sixteen' },
  { patterns: ['elite eight', 'elite 8', 'regional final'],                        round: 'Elite Eight' },
  { patterns: ['final four', 'national semifinal'],                                 round: 'Final Four' },
  { patterns: ['national championship', 'championship', 'title game', 'final'],    round: 'Championship' },
]

function detectRoundName(event) {
  // Check multiple ESPN fields where round info might live
  const candidates = [
    event.notes?.[0]?.headline,
    event.season?.slug,
    event.seasonType?.name,
    event.name,
    event.shortName,
    event.season?.type?.name,
  ].filter(Boolean).map(s => s.toLowerCase())

  for (const { patterns, round } of ESPN_ROUND_MAP) {
    for (const candidate of candidates) {
      for (const pattern of patterns) {
        if (candidate.includes(pattern)) return round
      }
    }
  }
  return null
}

function normalizeName(name) {
  return name.toLowerCase().trim()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
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
        const pts = parseInt(athlete.stats?.[ptsIndex], 10)
        if (displayName && !isNaN(pts)) {
          if (!results[displayName] || pts > results[displayName].points) {
            results[displayName] = { points: pts, roundName }
          }
        }
      }
    }
  }
  return results
}

function findBestNameMatch(ourName, espnNames) {
  const norm = normalizeName(ourName)
  const parts = norm.split(' ')
  const lastName = parts[parts.length - 1]
  const firstName = parts[0]

  // 1. Exact normalized match
  for (const en of espnNames) {
    if (normalizeName(en) === norm) return en
  }

  // 2. Last name + first initial
  for (const en of espnNames) {
    const en_norm = normalizeName(en)
    const en_parts = en_norm.split(' ')
    if (en_parts[en_parts.length - 1] === lastName && en_norm[0] === firstName[0]) return en
  }

  // 3. Last name only (unique)
  const lastNameMatches = espnNames.filter(en => {
    const en_parts = normalizeName(en).split(' ')
    return en_parts[en_parts.length - 1] === lastName
  })
  if (lastNameMatches.length === 1) return lastNameMatches[0]

  return null
}

function todayStr() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

async function fetchEventsForDate(dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`
  try {
    const res = await fetch(url)
    const data = await res.json()
    return data.events || []
  } catch (e) {
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

export async function syncTournamentScores(onProgress) {
  const today = todayStr()
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= today)

  if (datesToFetch.length === 0) {
    return { matched: [], unmatched: [], message: 'Tournament has not started yet.' }
  }

  onProgress?.(`Checking ${datesToFetch.length} tournament date(s) up to today...`)

  // Collect all player stats across completed games
  const allStats = {}
  let gamesProcessed = 0

  for (const dateStr of datesToFetch) {
    const events = await fetchEventsForDate(dateStr)
    onProgress?.(`${dateStr}: found ${events.length} events`)

    for (const event of events) {
      const isCompleted = event.status?.type?.completed
      if (!isCompleted) continue

      const roundName = detectRoundName(event)

      // Log what we see so you can debug mismatches
      const headline = event.notes?.[0]?.headline || '(no headline)'
      onProgress?.(`  ✓ ${event.shortName || event.id} → round: "${roundName || '?'}" (ESPN said: "${headline}")`)

      if (!roundName) continue

      const summary = await fetchGameSummary(event.id)
      if (!summary) continue

      const gamePlayers = parsePlayerPointsFromSummary(summary, roundName)
      for (const [name, stats] of Object.entries(gamePlayers)) {
        if (!allStats[name]) allStats[name] = []
        const exists = allStats[name].some(s => s.roundName === stats.roundName)
        if (!exists) allStats[name].push(stats)
      }
      gamesProcessed++
    }
  }

  const espnNames = Object.keys(allStats)
  onProgress?.(`Processed ${gamesProcessed} completed games, found ${espnNames.length} players with stats`)

  if (espnNames.length === 0) {
    return {
      matched: [],
      unmatched: [],
      message: 'No completed tournament games found yet — ESPN may not have box scores available. Try again in a few minutes after games finish.',
    }
  }

  // Get all drafted players
  const { data: draftedPlayers, error } = await supabase
    .from('players')
    .select('id, name')
    .not('drafter_id', 'is', null)

  if (error) throw new Error('DB error: ' + error.message)

  onProgress?.(`Matching ${draftedPlayers.length} drafted players against ESPN data...`)

  const matched = []
  const unmatched = []

  for (const player of draftedPlayers) {
    const espnName = findBestNameMatch(player.name, espnNames)

    if (espnName) {
      for (const { roundName, points } of allStats[espnName]) {
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

  await supabase.from('settings').upsert({ key: 'last_espn_sync', value: new Date().toISOString() })

  return { matched, unmatched }
}
