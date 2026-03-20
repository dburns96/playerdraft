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
    const competitors = event.competitions?.[0]?.competitors || [];
    for (const c of competitors) {
      if (c.winner === false && c.team?.id) {
        losingTeamIds.add(String(c.team.id));
      }
    }
  }

  if (losingTeamIds.size === 0) return;

  const { data: players } = await supabase.from('players').select('id, name, team, espn_team_id').eq('is_eliminated', false).not('espn_team_id', 'is', null);
  if (!players || players.length === 0) return;

  const toEliminate = players.filter(p => losingTeamIds.has(String(p.espn_team_id)));
  if (toEliminate.length === 0) return;

  await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id));
  onProgress?.(`✓ Confirmed Eliminations: ${toEliminate.map(p => `${p.name} (${p.team})`).join(', ')}`);
}

export async function syncTournamentScores(onProgress) {
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= todayStr);
  const allStats = {};
  const completedEvents = [];

  for (const dateStr of datesToFetch) {
    // URL uses group 50 for Men's D1 specifically
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=50&limit=300`);
    const { events = [] } = await res.json();

    for (const event of events) {
      // FIX 1: Only process if the game's actual date matches the loop's dateStr
      // This stops Arizona's March 14 loss from leaking into March 19
      const actualEventDate = event.date.slice(0, 10).replace(/-/g, '');
      if (actualEventDate !== dateStr) continue;

      // FIX 2: Only process Men's NCAA Tournament (Season Type 3)
      if (event.season?.type !== 3 && event.season?.type !== '3') continue;

      const roundName = DATE_TO_ROUND[dateStr] || 'Postseason';
      
      if (event.status?.type?.name === 'STATUS_FINAL') {
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
              const pName = ath.athlete.displayName;
              if (!allStats[pName]) allStats[pName] = [];
              // Prevent duplicate score entries for the same game
              if (!allStats[pName].some(s => s.gameId === event.id)) {
                allStats[pName].push({ points: pts, roundName, gameId: event.id });
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