import { supabase } from './supabase.js'

const TOURNAMENT_DATES = ['20260317', '20260318', '20260319', '20260320', '20260321', '20260322']

const DATE_TO_ROUND = {
  '20260317': 'Play-In', '20260318': 'Play-In',
  '20260319': 'Round of 64', '20260320': 'Round of 64',
  '20260321': 'Round of 32', '20260322': 'Round of 32'
}

async function autoEliminateLosers(completedEvents, onProgress) {
  const losingTeamIds = new Set();
  
  for (const event of completedEvents) {
    // LAYER 1: League & Status Check
    // League "50" is Men's College Basketball. 
    // Status name "STATUS_FINAL" ensures the game is actually over.
    if (event.status?.type?.name !== 'STATUS_FINAL') continue;
    
    // LAYER 2: Tournament Only
    // Season type 3 is Postseason. Headline check prevents NIT/CBI leaks.
    const headline = (event.notes?.[0]?.headline || "").toLowerCase();
    if (event.season?.type !== 3 && !headline.includes("ncaa")) continue;

    const competitors = event.competitions?.[0]?.competitors || [];
    const team1 = competitors[0];
    const team2 = competitors[1];
    if (!team1 || !team2) continue;

    // LAYER 3: The Score Lock
    // A team cannot lose if the game score is 0-0.
    const score1 = parseInt(team1.score || "0");
    const score2 = parseInt(team2.score || "0");

    if (score1 > 0 && score2 > 0) {
      if (team1.winner === false && score1 < score2) losingTeamIds.add(String(team1.team.id));
      if (team2.winner === false && score2 < score1) losingTeamIds.add(String(team2.team.id));
    }
  }

  if (losingTeamIds.size === 0) return;

  const { data: players } = await supabase
    .from('players')
    .select('id, name, team, espn_team_id')
    .eq('is_eliminated', false)
    .not('espn_team_id', 'is', null);

  if (!players || players.length === 0) return;

  // Strict ID match to the "Loser Set" we just built
  const toEliminate = players.filter(p => losingTeamIds.has(String(p.espn_team_id)));
  if (toEliminate.length === 0) return;

  await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id));
  onProgress?.(`✓ Validated Eliminations: ${toEliminate.map(p => `${p.name} (${p.team})`).join(', ')}`);
}

export async function syncTournamentScores(onProgress) {
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= todayStr);
  
  const allStats = {};
  const completedEvents = [];

  for (const dateStr of datesToFetch) {
    // Explicitly call the Men's Basketball endpoint
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`);
    const { events = [] } = await res.json();

    for (const event of events) {
      const eventDate = event.date.slice(0, 10).replace(/-/g, '');
      const roundName = DATE_TO_ROUND[eventDate] || 'Round of 64';
      
      if (event.status?.type?.completed) {
        event._tournamentRound = roundName;
        completedEvents.push(event);
      }

      const sumRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${event.id}`);
      const summary = await sumRes.json();
      summary.boxscore?.players?.forEach(team => {
        team.statistics?.forEach(group => {
          const ptsIdx = (group.names || []).indexOf('PTS');
          group.athletes?.forEach(ath => {
            const pts = parseInt(ath.stats?.[ptsIdx]);
            if (ath.athlete?.displayName && !isNaN(pts)) {
              if (!allStats[ath.athlete.displayName]) allStats[ath.athlete.displayName] = [];
              if (!allStats[ath.athlete.displayName].some(s => s.roundName === roundName)) {
                allStats[ath.athlete.displayName].push({ points: pts, roundName });
              }
            }
          });
        });
      });
    }
  }

  await autoEliminateLosers(completedEvents, onProgress);

  const { data: drafted } = await supabase.from('players').select('id, name, team').not('drafter_id', 'is', null);
  if (drafted) {
    for (const p of drafted) {
      const stats = allStats[p.name];
      if (stats) {
        for (const s of stats) {
          await supabase.from('player_scores').upsert(
            { player_id: p.id, round_name: s.roundName, points: s.points, updated_at: new Date().toISOString() },
            { onConflict: 'player_id,round_name' }
          );
        }
      }
    }
  }
  return { matched: [], unmatched: [] };
}