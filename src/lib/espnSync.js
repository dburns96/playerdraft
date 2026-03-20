import { supabase } from './supabase.js'

const TOURNAMENT_DATES = [
  '20260317', '20260318', '20260319', '20260320', 
  '20260321', '20260322', '20260326', '20260327', 
  '20260328', '20260329', '20260404', '20260406'
]

async function autoEliminateLosers(completedEvents, onProgress) {
  const losingTeamIds = new Set()
  for (const event of completedEvents) {
    const competitors = event.competitions?.[0]?.competitors || []
    for (const c of competitors) {
      if (c.winner === false && c.team?.id) {
        losingTeamIds.add(String(c.team.id))
      }
    }
  }

  if (losingTeamIds.size === 0) return

  const { data: players } = await supabase
    .from('players')
    .select('id, name, espn_team_id')
    .eq('is_eliminated', false)
    .not('espn_team_id', 'is', null)

  if (!players || players.length === 0) return

  const toEliminate = players.filter(p => losingTeamIds.has(String(p.espn_team_id)))
  if (toEliminate.length === 0) return

  await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id))
  onProgress?.(`✓ Eliminated by ID: ${toEliminate.map(p => p.name).join(', ')}`)
}

export async function syncTournamentScores(onProgress) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= today)
  
  onProgress?.(`Checking ${datesToFetch.length} tournament date(s)...`)
  
  const allStats = {}
  const completedEvents = []
  const matched = []
  const unmatched = []

  for (const dateStr of datesToFetch) {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`)
    const { events = [] } = await res.json()

    for (const event of events) {
      if (!event.status?.type?.completed) continue
      
      const headline = (event.notes?.[0]?.headline || '').toLowerCase()
      // Identify tournament rounds for elimination logic
      if (headline.includes('round') || headline.includes('play-in') || headline.includes('sixteen') || headline.includes('eight')) {
        event._tournamentRound = headline
        completedEvents.push(event)

        const sumRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${event.id}`)
        const summary = await sumRes.json()

        summary.boxscore?.players?.forEach(team => {
          team.statistics?.forEach(group => {
            const ptsIdx = (group.names || []).indexOf('PTS')
            group.athletes?.forEach(ath => {
              const pts = parseInt(ath.stats?.[ptsIdx])
              if (ath.athlete?.displayName && !isNaN(pts)) {
                const pName = ath.athlete.displayName
                if (!allStats[pName]) allStats[pName] = []
                allStats[pName].push({ points: pts, roundName: headline })
              }
            })
          })
        })
      }
    }
  }

  // 1. Run ID-based elimination
  await autoEliminateLosers(completedEvents, onProgress)

  // 2. Sync scores for drafted players
  const { data: drafted } = await supabase
    .from('players')
    .select('id, name, team')
    .not('drafter_id', 'is', null)
  
  // Ensure 'drafted' is an array before looping to prevent the 'length' error
  if (drafted && drafted.length > 0) {
    onProgress?.(`Matching scores for ${drafted.length} players...`)
    for (const p of drafted) {
      const stats = allStats[p.name] // Simple name match for points
      if (stats) {
        for (const s of stats) {
          await supabase.from('player_scores').upsert(
            { player_id: p.id, round_name: s.roundName, points: s.points, updated_at: new Date().toISOString() },
            { onConflict: 'player_id,round_name' }
          )
        }
        matched.push(p.name)
      } else {
        unmatched.push(p.name)
      }
    }
  }

  await supabase.from('settings').upsert({ key: 'last_espn_sync', value: new Date().toISOString() })

  // Return the structure the UI expects
  return { matched, unmatched }
}