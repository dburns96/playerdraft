import { supabase } from './supabase.js'

const TOURNAMENT_DATES = [
  '20260317', '20260318', // Play-In
  '20260319', '20260320', // Round of 64
  '20260321', '20260322', // Round of 32
  '20260326', '20260327', // Sweet Sixteen
  '20260328', '20260329', // Elite Eight
  '20260404', '20260406'  // Final Four / Championship
]

// The absolute source of truth for round mapping
const DATE_TO_ROUND = {
  '20260317': 'Play-In', '20260318': 'Play-In',
  '20260319': 'Round of 64', '20260320': 'Round of 64',
  '20260321': 'Round of 32', '20260322': 'Round of 32',
  '20260326': 'Sweet Sixteen', '20260327': 'Sweet Sixteen',
  '20260328': 'Elite Eight', '20260329': 'Elite Eight',
  '20260404': 'Final Four', '20260406': 'Championship'
}

export async function syncTournamentScores(onProgress) {
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= todayStr);
  
  const allStats = {}; 
  const losingTeamIds = new Set();
  const processedGameIds = new Set();

  onProgress?.(`Starting Sync for ${datesToFetch.length} tournament days...`);

  for (const dateStr of datesToFetch) {
    // group 100 is specifically the NCAA Men's Tournament
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`;
    const res = await fetch(url);
    const { events = [] } = await res.json();

    for (const event of events) {
      if (processedGameIds.has(event.id)) continue;
      processedGameIds.add(event.id);

      // Determine the round strictly by the game's date
      const eventDateStr = event.date.slice(0, 10).replace(/-/g, '');
      const roundName = DATE_TO_ROUND[eventDateStr];
      if (!roundName) continue; // Safety: ignores games outside the tourney calendar

      // 1. ELIMINATION LOGIC
      // Only eliminate if the game is over (STATUS_FINAL)
      if (event.status?.type?.name === 'STATUS_FINAL') {
        const competitors = event.competitions?.[0]?.competitors || [];
        for (const c of competitors) {
          if (c.winner === false && c.team?.id) {
            losingTeamIds.add(String(c.team.id));
          }
        }
      }

      // 2. PLAYER SCORE LOGIC
      // This runs for ANY game that has started (not just STATUS_FINAL)
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
              allStats[pName].push({ points: pts, roundName });
            }
          });
        });
      });
    }
  }

  // UPDATE DATABASE: Eliminations
  if (losingTeamIds.size > 0) {
    const { data: players } = await supabase.from('players').select('id, name, team, espn_team_id').eq('is_eliminated', false).not('espn_team_id', 'is', null);
    const toEliminate = players?.filter(p => losingTeamIds.has(String(p.espn_team_id))) || [];
    if (toEliminate.length > 0) {
      await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id));
      onProgress?.(`✓ Processed eliminations for ${toEliminate.length} players.`);
    }
  }

  // UPDATE DATABASE: Scores
  const { data: drafted } = await supabase.from('players').select('id, name').not('drafter_id', 'is', null);
  let matchedCount = 0;
  if (drafted) {
    for (const p of drafted) {
      const stats = allStats[p.name];
      if (stats) {
        for (const s of stats) {
          await supabase.from('player_scores').upsert({
            player_id: p.id,
            round_name: s.roundName,
            points: s.points,
            updated_at: new Date().toISOString()
          }, { onConflict: 'player_id,round_name' });
          matchedCount++;
        }
      }
    }
  }

  onProgress?.(`✓ Sync complete. Updated scores for ${matchedCount} entries.`);
  return { matched: [], unmatched: [] };
}