import { supabase } from './supabase.js'

// Strict Date-to-Round Mapping
const TOURNAMENT_CALENDAR = {
  '2026-03-17': 'Play-In',
  '2026-03-18': 'Play-In',
  '2026-03-19': 'Round of 64',
  '2026-03-20': 'Round of 64',
  '2026-03-21': 'Round of 32',
  '2026-03-22': 'Round of 32',
  '2026-03-26': 'Sweet Sixteen',
  '2026-03-27': 'Sweet Sixteen',
  '2026-03-28': 'Elite Eight',
  '2026-03-29': 'Elite Eight',
  '2026-04-04': 'Final Four',
  '2026-04-06': 'Championship'
}

export async function syncTournamentScores(onProgress) {
  // Get all tournament dates up to today
  const allDates = Object.keys(TOURNAMENT_CALENDAR);
  const todayISO = new Date().toISOString().slice(0, 10);
  const datesToFetch = allDates.filter(date => date <= todayISO);

  const allStats = {}; // Format: { "Player Name": { "Round Name": points } }
  const processedGameIds = new Set();

  onProgress?.(`Fetching scores for ${datesToFetch.length} tournament days...`);

  for (const dateStr of datesToFetch) {
    const formattedDate = dateStr.replace(/-/g, '');
    // Groups=100 limits results specifically to the NCAA Tournament
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${formattedDate}&groups=100&limit=100`;
    
    try {
      const res = await fetch(url);
      const { events = [] } = await res.json();

      for (const event of events) {
        if (processedGameIds.has(event.id)) continue;

        // Use the game's official date to determine the round column
        const gameDate = event.date.slice(0, 10);
        const roundName = TOURNAMENT_CALENDAR[gameDate];
        
        if (!roundName) continue; // Skip games outside the defined tournament window
        processedGameIds.add(event.id);

        // Fetch detailed player boxscore
        const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${event.id}`;
        const sumRes = await fetch(summaryUrl);
        const summary = await sumRes.json();

        summary.boxscore?.players?.forEach(teamData => {
          teamData.statistics?.forEach(statGroup => {
            const ptsIdx = (statGroup.names || []).indexOf('PTS');
            if (ptsIdx === -1) return;

            statGroup.athletes?.forEach(ath => {
              const pts = parseInt(ath.stats?.[ptsIdx]);
              const playerName = ath.athlete?.displayName;

              if (playerName && !isNaN(pts) && pts > 0) {
                if (!allStats[playerName]) allStats[playerName] = {};
                // Add points (handles players who might somehow play twice in a round, though rare)
                allStats[playerName][roundName] = (allStats[playerName][roundName] || 0) + pts;
              }
            });
          });
        });
      }
    } catch (err) {
      console.error(`Failed to fetch data for ${dateStr}:`, err);
    }
  }

  // --- Update Supabase ---
  const { data: draftedPlayers } = await supabase
    .from('players')
    .select('id, name')
    .not('drafter_id', 'is', null);

  if (!draftedPlayers) return { matched: [], unmatched: [] };

  let updateCount = 0;
  for (const player of draftedPlayers) {
    const rounds = allStats[player.name];
    if (rounds) {
      for (const [roundName, points] of Object.entries(rounds)) {
        await supabase.from('player_scores').upsert({
          player_id: player.id,
          round_name: roundName,
          points: points,
          updated_at: new Date().toISOString()
        }, { onConflict: 'player_id,round_name' });
        updateCount++;
      }
    }
  }

  onProgress?.(`✓ Success: Updated ${updateCount} score entries.`);
  return { matched: [], unmatched: [] };
}