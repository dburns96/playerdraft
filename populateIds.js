import { supabase } from './supabase.js'

async function populateTeamIds() {
  console.log("Fetching all NCAA teams from ESPN...")
  // This fetches every D1 team to ensure we cover all 68 in the tournament
  const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=1000')
  const data = await res.json()
  const espnTeams = data.sports[0].leagues[0].teams.map(t => t.team)

  // Get all your drafted players who don't have an ID yet
  const { data: players } = await supabase
    .from('players')
    .select('id, team')
    .is('espn_team_id', null)

  if (!players || players.length === 0) {
    console.log("No players found needing an ID update.")
    return
  }

  console.log(`Checking ${players.length} players...`)

  for (const player of players) {
    // Search for the team by full name or short name
    const match = espnTeams.find(t => 
      t.displayName.toLowerCase() === player.team.toLowerCase() || 
      t.shortDisplayName.toLowerCase() === player.team.toLowerCase() ||
      t.name.toLowerCase() === player.team.toLowerCase()
    )

    if (match) {
      const { error } = await supabase
        .from('players')
        .update({ espn_team_id: match.id })
        .eq('id', player.id)
      
      if (!error) {
        console.log(`✓ Linked ${player.team} to ESPN ID: ${match.id}`)
      }
    } else {
      console.log(`? Could not find an ESPN ID for: "${player.team}"`)
    }
  }
  console.log("Done!")
}

populateTeamIds()