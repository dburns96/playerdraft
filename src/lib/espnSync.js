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

  const { data: players } = await supabase.from('players').select('id, name, espn_team_id').eq('is_eliminated', false).not('espn_team_id', 'is', null);
  if (!players?.length) return;

  // STRICT ID-ONLY MATCHING: No names, no guessing.
  const toEliminate = players.filter(p => losingTeamIds.has(String(p.espn_team_id)));
  if (toEliminate.length === 0) return;

  await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id));
  onProgress?.(`✓ Eliminated by ID: ${toEliminate.map(p => p.name).join(', ')}`);
}

export async function syncTournamentScores(onProgress) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= today);
  const allStats = {};
  const completedEvents = [];

  for (const dateStr of datesToFetch) {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`);
    const { events = [] } = await res.json();

    for (const event of events) {
      // Prioritize the date-based round name to avoid the "Championship" headline trap
      const roundName = DATE_TO_ROUND[dateStr] || 'Postseason';
      
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
              allStats[ath.athlete.displayName].push({ points: pts, roundName });
            }
          });
        });
      });
    }
  }

  await autoEliminateLosers(completedEvents, onProgress);

  const { data: drafted } = await supabase.from('players').select('id, name, team').not('drafter_id', 'is', null);
  const matched = []; const unmatched = [];
  if (drafted) {
    for (const p of drafted) {
      const stats = allStats[p.name];
      if (stats) {
        for (const s of stats) {
          await supabase.from('player_scores').upsert({ player_id: p.id, round_name: s.roundName, points: s.points, updated_at: new Date().toISOString() }, { onConflict: 'player_id,round_name' });
        }
        matched.push(p.name);
      } else { unmatched.push(p.name); }
    }
  }
  return { matched, unmatched };
}