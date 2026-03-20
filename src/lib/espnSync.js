import { supabase } from './supabase.js'

const TOURNAMENT_DATES = [
  '20260317', '20260318', '20260319', '20260320', 
  '20260321', '20260322', '20260326', '20260327', 
  '20260328', '20260329', '20260404', '20260406'
]

async function autoEliminateLosers(completedEvents, onProgress) {
  const losingTeamIds = new Set()
  
  for (const event of completedEvents) {
    // Only process tournament games (Round of 64, etc.)
    if (!event._tournamentRound) continue
    
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
    .select('id, name, team, espn_team_id')
    .eq('is_eliminated', false)
    .not('espn_team_id', 'is', null)

  if (!players?.length) return

  // THE FIX: Strict ID-to-ID matching. No more name confusion!
  const toEliminate = players.filter(p => losingTeamIds.has(String(p.espn_team_id)))

  if (toEliminate.length === 0) return

  const ids = toEliminate.map(p => p.id)
  await supabase.from('players').update({ is_eliminated: true }).in('id', ids)
  onProgress?.(`✓ Auto-eliminated by ID: ${toEliminate.map(p => `${p.name} (${p.team})`).join(', ')}`)
}

export async function syncTournamentScores(onProgress) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= today)
  
  onProgress?.(`Syncing scores for ${datesToFetch.length} date(s)...`)
  
  const allStats = {}
  const completedEvents = []

  for (const dateStr of datesToFetch) {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`)
    const { events } = await res.json()

    for (const event of events) {
      if (!event.status?.type?.completed) continue
      
      const headline = (event.notes?.[0]?.headline || '').toLowerCase()
      let roundName = null
      if (headline.includes('first round') || headline.includes('round of 64')) roundName = 'Round of 64'
      else if (headline.includes('second round') || headline.includes('round of 32')) roundName = 'Round of 32'
      else if (headline.includes('play-in')) roundName = 'Play-In'

      if (!roundName) continue
      
      event._tournamentRound = roundName
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
              allStats[pName].push({ points: pts, roundName })
            }
          })
        })
      })
    }
  }

  await autoEliminateLosers(completedEvents, onProgress)
  // ... (Your existing code to save points to player_scores goes here)
  return { message: 'Sync complete' }
}