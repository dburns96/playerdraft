import { supabase } from './supabase.js'

const TOURNAMENT_DATES = [
  '20260317', '20260318', '20260319', '20260320', 
  '20260321', '20260322', '20260326', '20260327', 
  '20260328', '20260329', '20260404', '20260406'
]

async function autoEliminateLosers(completedEvents, onProgress) {
  const losingTeamIds = new Set()
  for (const event of completedEvents) {
    if (!event.status?.type?.completed) continue
    const competitors = event.competitions?.[0]?.competitors || []
    for (const c of competitors) {
      if (c.winner === false && c.team?.id) {
        losingTeamIds.add(String(c.team.id))
      }
    }
  }
  if (losingTeamIds.size === 0) return

  const { data: players } = await supabase.from('players').select('id, name, espn_team_id').eq('is_eliminated', false).not('espn_team_id', 'is', null)
  if (!players?.length) return

  const toEliminate = players.filter(p => losingTeamIds.has(String(p.espn_team_id)))
  if (toEliminate.length === 0) return

  await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id))
  onProgress?.(`✓ Eliminated by ID: ${toEliminate.map(p => p.name).join(', ')}`)
}

export async function syncTournamentScores(onProgress) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= today)
  const allStats = {}
  const completedEvents = []

  for (const dateStr of datesToFetch) {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`)
    const { events } = await res.json()
    for (const event of events) {
      if (!event.status?.type?.completed) continue
      const headline = (event.notes?.[0]?.headline || '').toLowerCase()
      if (headline.includes('round') || headline.includes('play-in')) {
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
                if (!allStats[ath.athlete.displayName]) allStats[ath.athlete.displayName] = []
                allStats[ath.athlete.displayName].push({ points: pts, roundName: headline })
              }
            })
          })
        })
      }
    }
  }
  await autoEliminateLosers(completedEvents, onProgress)
  return { message: 'Sync complete' }
}