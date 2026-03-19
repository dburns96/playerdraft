import { supabase } from './supabase.js'

const TOURNAMENT_DATES = [
  '20260317', '20260318', // Play-In
  '20260319', '20260320', // Round of 64
  '20260321', '20260322', // Round of 32
  '20260326', '20260327', // Sweet Sixteen
  '20260328', '20260329', // Elite Eight
  '20260404',             // Final Four
  '20260406',             // Championship
]

const DATE_TO_ROUND = {
  '20260317': 'Play-In',
  '20260318': 'Play-In',
  '20260319': 'Round of 64',
  '20260320': 'Round of 64',
  '20260321': 'Round of 32',
  '20260322': 'Round of 32',
  '20260326': 'Sweet Sixteen',
  '20260327': 'Sweet Sixteen',
  '20260328': 'Elite Eight',
  '20260329': 'Elite Eight',
  '20260404': 'Final Four',
  '20260406': 'Championship',
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

function normalizeName(name) {
  return name.toLowerCase().trim()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
}

function extractParts(name) {
  const parts = normalizeName(name).split(' ').filter(p => p && !SUFFIXES.has(p))
  return {
    first: parts[0] || '',
    last: parts[parts.length - 1] || '',
    full: parts.join(' '),
  }
}

// Improved Team Matching Logic
function teamsMatch(ourTeam, espnTeam) {
  if (!ourTeam || !espnTeam) return false
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const a = normalize(ourTeam)
  const b = normalize(espnTeam)

  // 1. Direct match
  if (a === b) return true

  // 2. Handle known common aliases
  const aliases = {
    'uconn': 'connecticut',
    'ncstate': 'northcarolinastate',
    'pennst': 'pennsylvania-state',
    'ohiost': 'ohio-state'
  }
  if (aliases[a] === b || aliases[b] === a) return true

  // 3. Fuzzy match (one contains the other)
  if (a.includes(b) || b.includes(a)) {
    // CRITICAL FIX: Prevent "Florida" matching "Florida A&M" or "Michigan" matching "Michigan State"
    const isStateMismatch = (a.includes('state') !== b.includes('state') || a.includes('st') !== b.includes('st'))
    const isAmMismatch = (a.includes('am') !== b.includes('am'))
    
    if (isStateMismatch || isAmMismatch) return false
    
    return true
  }

  return false
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

  return null
}

function isTournamentGame(event) {
  const comp = event.competitions?.[0]
  if (!comp?.neutralSite) return false
  if (event.season?.type === 3 || event.season?.type === '3') return true
  const groupName = (event.groups?.name || event.groups?.[0]?.name || '').toLowerCase()
  if (groupName.includes('ncaa') || groupName.includes('tournament')) return true
  const headline = (event.notes?.[0]?.headline || comp?.notes?.[0]?.headline || '').toLowerCase()
  if (headline.includes('ncaa') || headline.includes('tournament') ||
      headline.includes('first four') || headline.includes('first round')) return true
  return false
}

function detectRoundName(event, dateStr) {
  const comp = event.competitions?.[0]
  const candidates = [
    event.notes?.[0]?.headline,
    comp?.notes?.[0]?.headline,
    event.name,
    event.shortName,
    comp?.type?.text,
  ].filter(Boolean).map(s => s.toLowerCase())

  const ESPN_ROUND_MAP = [
    { patterns: ['first four', 'play-in'],       round: 'Play-In' },
    { patterns: ['first round', 'round of 64'],  round: 'Round of 64' },
    { patterns: ['second round', 'round of 32'], round: 'Round of 32' },
    { patterns: ['sweet sixteen', 'sweet 16'],   round: 'Sweet Sixteen' },
    { patterns: ['elite eight', 'elite 8'],      round: 'Elite Eight' },
    { patterns: ['final four'],                  round: 'Final Four' },
    { patterns: ['championship'],                round: 'Championship' },
  ]

  for (const { patterns, round } of ESPN_ROUND_MAP) {
    for (const candidate of candidates) {
      for (const pattern of patterns) {
        if (candidate.includes(pattern)) return round
      }
    }
  }

  if (isTournamentGame(event)) {
    return DATE_TO_ROUND[dateStr] || null
  }
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

async function fetchEventsForDate(dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`
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

async function autoEliminateLosers(completedEvents, onProgress) {
  const losingTeams = new Set()
  for (const event of completedEvents) {
    if (!event._tournamentRound) continue
    const competitors = event.competitions?.[0]?.competitors || []
    for (const c of competitors) {
      if (c.winner === false) {
        const name = c.team?.displayName || c.team?.name || ''
        if (name) losingTeams.add(name)
      }
    }
  }

  if (losingTeams.size === 0) return

  const { data: players } = await supabase
    .from('players')
    .select('id, name, team')
    .eq('is_eliminated', false)

  if (!players?.length) return

  const toEliminate = players.filter(p => {
    for (const loser of losingTeams) {
      if (teamsMatch(p.team, loser)) return true
    }
    return false
  })

  if (toEliminate.length === 0) return

  const ids = toEliminate.map(p => p.id)
  await supabase.from('players').update({ is_eliminated: true }).in('id', ids)
  onProgress?.(`✓ Auto-eliminated: ${toEliminate.map(p => `${p.name} (${p.team})`).join(', ')}`)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

export async function syncTournamentScores(onProgress) {
  const today = todayStr()
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= today)

  if (datesToFetch.length === 0) {
    return { matched: [], unmatched: [], message: 'Tournament has not started yet.' }
  }

  onProgress?.(`Checking ${datesToFetch.length} tournament date(s)...`)

  const allStats = {}
  const espnIdMap = {}
  const completedEvents = []
  let gamesProcessed = 0

  for (const dateStr of datesToFetch) {
    const events = await fetchEventsForDate(dateStr)
    for (const event of events) {
      if (!event.status?.type?.completed) continue
      const roundName = detectRoundName(event, dateStr)
      if (!roundName) continue

      event._tournamentRound = roundName
      completedEvents.push(event)

      const summary = await fetchGameSummary(event.id)
      if (!summary) continue

      const gamePlayers = parsePlayerPoints(summary, roundName)
      for (const [name, stats] of Object.entries(gamePlayers)) {
        if (!allStats[name]) allStats[name] = []
        if (!allStats[name].some(s => s.roundName === stats.roundName)) {
          allStats[name].push({ points: stats.points, roundName: stats.roundName, espnTeam: stats.espnTeam })
        }
        if (stats.espnId) espnIdMap[name] = stats.espnId
      }
      gamesProcessed++
    }
  }

  await autoEliminateLosers(completedEvents, onProgress)

  const { data: draftedPlayers, error } = await supabase
    .from('players')
    .select('id, name, team, espn_player_id')
    .not('drafter_id', 'is', null)

  if (error) throw new Error('DB error: ' + error.message)

  const matched = []
  const unmatched = []

  for (const player of draftedPlayers) {
    let espnName = player.espn_player_id
      ? findByEspnId(player.espn_player_id, espnIdMap)
      : null

    const matchedByName = !espnName
    if (!espnName) {
      espnName = findBestNameMatch(player.name, player.team, allStats)
    }

    if (espnName) {
      if (matchedByName && !player.espn_player_id) {
        const espnId = espnIdMap[espnName]
        if (espnId) await supabase.from('players').update({ espn_player_id: espnId }).eq('id', player.id)
      }

      for (const { roundName, points } of allStats[espnName]) {
        await supabase.from('player_scores').upsert(
          { player_id: player.id, round_name: roundName, points, updated_at: new Date().toISOString() },
          { onConflict: 'player_id,round_name' }
        )
      }
      matched.push({ ourName: player.name, espnName, method: matchedByName ? 'name' : 'id' })
    } else {
      unmatched.push(player.name)
    }
  }

  await supabase.from('settings').upsert({ key: 'last_espn_sync', value: new Date().toISOString() })
  return { matched, unmatched }
}