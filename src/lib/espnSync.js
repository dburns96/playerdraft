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

// Normalize team names for fuzzy comparison
function teamsMatch(ourTeam, espnTeam) {
  if (!ourTeam || !espnTeam) return false
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const a = normalize(ourTeam)
  const b = normalize(espnTeam)
  // Direct match or one contains the other (handles "UConn" vs "Connecticut Huskies")
  return a === b || a.includes(b) || b.includes(a)
}

function findByEspnId(espnPlayerId, allStats) {
  if (!espnPlayerId) return null
  for (const [name, stats] of Object.entries(allStats)) {
    if (stats.some(s => s.espnId === espnPlayerId)) return name
  }
  return null
}

function findBestNameMatch(ourName, ourTeam, allStats) {
  const our = extractParts(ourName)
  const espnNames = Object.keys(allStats)

  // 1. Exact name + team
  for (const en of espnNames) {
    if (extractParts(en).full === our.full && teamsMatch(ourTeam, allStats[en][0]?.espnTeam)) return en
  }

  // 2. Exact name, any team
  for (const en of espnNames) {
    if (extractParts(en).full === our.full) return en
  }

  // 3. First initial + last name + team
  for (const en of espnNames) {
    const ep = extractParts(en)
    if (ep.last === our.last && our.first.length > 0 && ep.first[0] === our.first[0]
        && teamsMatch(ourTeam, allStats[en][0]?.espnTeam)) return en
  }

  // 4. First initial + last name, no team data available
  for (const en of espnNames) {
    const ep = extractParts(en)
    if (ep.last === our.last && our.first.length > 0 && ep.first[0] === our.first[0]
        && !allStats[en][0]?.espnTeam) return en
  }

  return null
}

function detectRoundName(event, dateStr) {
  // Try ESPN text fields first
  const comp = event.competitions?.[0]
  const candidates = [
    event.notes?.[0]?.headline,
    comp?.notes?.[0]?.headline,
    event.name,
    event.shortName,
    comp?.type?.text,
  ].filter(Boolean).map(s => s.toLowerCase())

  const ESPN_ROUND_MAP = [
    { patterns: ['first four', 'play-in', 'opening round'], round: 'Play-In' },
    { patterns: ['first round', 'round of 64'],             round: 'Round of 64' },
    { patterns: ['second round', 'round of 32'],            round: 'Round of 32' },
    { patterns: ['sweet sixteen', 'sweet 16'],              round: 'Sweet Sixteen' },
    { patterns: ['elite eight', 'elite 8'],                 round: 'Elite Eight' },
    { patterns: ['final four'],                             round: 'Final Four' },
    { patterns: ['national championship', 'championship'],  round: 'Championship' },
  ]

  for (const { patterns, round } of ESPN_ROUND_MAP) {
    for (const candidate of candidates) {
      for (const pattern of patterns) {
        if (candidate.includes(pattern)) return round
      }
    }
  }

  // Fallback: infer from date — reliable since we only query known tournament dates
  return DATE_TO_ROUND[dateStr] || null
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
    // Only eliminate based on tournament games — skip regular season / conf tournament
    // We verify by checking that the round was successfully identified as a tournament round
    if (!event._tournamentRound) continue

    const competitors = event.competitions?.[0]?.competitors || []
    for (const c of competitors) {
      if (c.winner === false) {
        const name = c.team?.displayName || c.team?.name || ''
        if (name) losingTeams.add(name.toLowerCase())
      }
    }
  }

  if (losingTeams.size === 0) return
  onProgress?.(`Checking eliminations against ${losingTeams.size} team(s) that lost...`)

  const { data: players } = await supabase
    .from('players')
    .select('id, name, team')
    .eq('is_eliminated', false)

  if (!players?.length) return

  const toEliminate = players.filter(p => {
    const team = p.team.toLowerCase()
    for (const loser of losingTeams) {
      if (loser.includes(team) || team.includes(loser.split(' ')[0])) return true
    }
    return false
  })

  if (toEliminate.length === 0) {
    onProgress?.('No new eliminations detected.')
    return
  }

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

  // Step 1: Collect all completed events and player stats
  const allStats = {}
  const completedEvents = []
  let gamesProcessed = 0

  for (const dateStr of datesToFetch) {
    const events = await fetchEventsForDate(dateStr)
    onProgress?.(`${dateStr}: found ${events.length} event(s)`)

    for (const event of events) {
      if (!event.status?.type?.completed) continue

      const roundName = detectRoundName(event, dateStr)
      const label = event.shortName || event.id
      onProgress?.(`  ✓ ${label} → ${roundName || '?'}`)

      // Tag with tournament round so auto-elimination only fires on real tournament games
      event._tournamentRound = roundName || null
      completedEvents.push(event)

      if (!roundName) continue

      const summary = await fetchGameSummary(event.id)
      if (!summary) continue

      const gamePlayers = parsePlayerPoints(summary, roundName)
      for (const [name, stats] of Object.entries(gamePlayers)) {
        if (!allStats[name]) allStats[name] = []
        if (!allStats[name].some(s => s.roundName === stats.roundName)) {
          allStats[name].push(stats)
        }
      }
      gamesProcessed++
    }
  }

  const espnNames = Object.keys(allStats)
  onProgress?.(`Processed ${gamesProcessed} game(s), found ${espnNames.length} players with stats`)
  // Note: espnNames still used for progress reporting above

  // Step 2: Auto-eliminate losers
  await autoEliminateLosers(completedEvents, onProgress)

  // Step 3: Match and write scores
  const { data: draftedPlayers, error } = await supabase
    .from('players')
    .select('id, name, team, espn_player_id')
    .not('drafter_id', 'is', null)

  if (error) throw new Error('DB error: ' + error.message)

  onProgress?.(`Matching ${draftedPlayers.length} drafted players...`)

  const matched = []
  const unmatched = []

  for (const player of draftedPlayers) {
    // Try ID match first (fast, reliable, no ambiguity)
    let espnName = player.espn_player_id
      ? findByEspnId(player.espn_player_id, allStats)
      : null

    const matchedByName = !espnName
    if (!espnName) {
      espnName = findBestNameMatch(player.name, player.team, allStats)
    }

    if (espnName) {
      // Save ESPN ID back to DB if we matched by name and don't have it yet
      if (matchedByName && !player.espn_player_id) {
        const espnId = allStats[espnName]?.[0]?.espnId
        if (espnId) {
          await supabase.from('players').update({ espn_player_id: espnId }).eq('id', player.id)
        }
      }

      for (const { roundName, points } of allStats[espnName]) {
        await supabase.from('player_scores').upsert(
          { player_id: player.id, round_name: roundName, points, updated_at: new Date().toISOString() },
          { onConflict: 'player_id,round_name' }
        )
      }
      matched.push({
        ourName: player.name,
        espnName,
        method: matchedByName ? 'name' : 'id',
      })
    } else {
      unmatched.push(player.name)
    }
  }

  await supabase.from('settings').upsert({ key: 'last_espn_sync', value: new Date().toISOString() })

  return { matched, unmatched }
}
