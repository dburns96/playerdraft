import { supabase } from './supabase.js'

// The only dates that matter for the NCAA Tournament
const TOURNAMENT_DATES = [
  '20260317', '20260318', // First Four (Play-In)
  '20260319', '20260320', // Round of 64
  '20260321', '20260322', // Round of 32
]

// STRICT: The round name is tied to the date of the game
const DATE_TO_ROUND = {
  '20260317': 'Play-In', '20260318': 'Play-In',
  '20260319': 'Round of 64', '20260320': 'Round of 64',
  '20260321': 'Round of 32', '20260322': 'Round of 32'
}

export async function syncTournamentScores(onProgress) {
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= todayStr);
  
  const allStats = {}; 
  const losingTeamIds = new Set();
  const processedGameIds = new Set();

  onProgress?.(`Starting Sync for ${datesToFetch.length} tournament days...`);

  for (const dateStr of datesToFetch) {
    // group 50 = Men's Division I. 
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=50&limit=300`;
    const res = await fetch(url);
    const { events = [] } = await res.json();

    for (const event of events) {
      if (processedGameIds.has(event.id)) continue;

      // 1. TEMPORAL GUARD: Ignore anything before March 17 (Blocks Arizona's March 14 conference loss)
      const eventDateStr = event.date.slice(0, 10).replace(/-/g, '');
      if (eventDateStr < '20260317') continue;

      // 2. TOURNAMENT GUARD: Only Men's Postseason (Season Type 3)
      if (event.season?.type !== 3 && event.season?.type !== '3') continue;

      const roundName = DATE_TO_ROUND[eventDateStr];
      if (!roundName) continue; 

      processedGameIds.add(event.id);

      // 3. ELIMINATION ENGINE
      // Only eliminate if game is STATUS_FINAL and scores are real
      if (event.status?.type?.name === 'STATUS_FINAL') {
        const competitors = event.competitions?.[0]?.competitors || [];
        for (const c of competitors) {
          if (c.winner === false && c.team?.id) {
            losingTeamIds.add(String(c.team.id));
          }
        }
      }

      // 4. POINT ENGINE (Fetch summary for player boxscores)
      const sumRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${event.id}`);
      const summary = await sumRes.json();

      summary.boxscore?.players?.forEach(teamData => {
        teamData.statistics?.forEach(statGroup => {
          const ptsIdx = (statGroup.names || []).indexOf('PTS');
          if (ptsIdx === -1) return;

          statGroup.athletes?.forEach(ath => {
            const pts = parseInt(ath.stats?.[ptsIdx]);
            if (ath.athlete?.displayName && !isNaN(pts)) {
              const pName = ath.athlete.displayName;
              if (!allStats[pName]) allStats[pName] = [];
              // Unique score per player/round/game
              if (!allStats[pName].some(s => s.gameId === event.id)) {
                allStats[pName].push({ points: pts, roundName, gameId: event.id });
              }
            }
          });
        });
      });
    }
  }

  // --- DATABASE UPDATE PHASE ---

  // Update Eliminations
  if (losingTeamIds.size > 0) {
    const { data: activePlayers } = await supabase.from('players').select('id, team, espn_team_id').eq('is_eliminated', false).not('espn_team_id', 'is', null);
    const toEliminate = activePlayers?.filter(p => losingTeamIds.has(String(p.espn_team_id))) || [];
    if (toEliminate.length > 0) {
      await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id));
      onProgress?.(`✓ Eliminated ${toEliminate.length} players who lost.`);
    }
  }

  // Update Scores
  const { data: drafted } = await supabase.from('players').select('id, name').not('drafter_id', 'is', null);
  let totalPointsSaved = 0;
  if (drafted) {
    for (const p of drafted) {
      const playerGames = allStats[p.name];
      if (playerGames) {
        for (const game of playerGames) {
          await supabase.from('player_scores').upsert({
            player_id: p.id,
            round_name: game.roundName,
            points: game.points,
            updated_at: new Date().toISOString()
          }, { onConflict: 'player_id,round_name' });
          totalPointsSaved++;
        }
      }
    }
  }

  onProgress?.(`✓ Sync complete. Saved ${totalPointsSaved} score entries.`);
  return { matched: [], unmatched: [] };
}