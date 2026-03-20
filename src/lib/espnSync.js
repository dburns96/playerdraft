import { supabase } from './supabase.js'

const TOURNAMENT_DATES = ['20260317', '20260318', '20260319', '20260320', '20260321', '20260322']

// Mapping official ESPN headlines to your App Round Names
const ROUND_MAP = {
  'first four': 'Play-In',
  'play-in': 'Play-In',
  'first round': 'Round of 64',
  'round of 64': 'Round of 64',
  'second round': 'Round of 32',
  'round of 32': 'Round of 32'
}

function getNormalizedRound(event) {
  const headline = (event.notes?.[0]?.headline || "").toLowerCase();
  const name = (event.name || "").toLowerCase();
  
  // Safety: If it's a conference tournament or NIT, skip it.
  if (headline.includes('nit') || headline.includes('cbi') || name.includes('conference')) return null;
  
  // Safety: Ensure it is an NCAA Tournament game
  if (!headline.includes('ncaa') && !name.includes('ncaa')) return null;

  for (const [key, value] of Object.entries(ROUND_MAP)) {
    if (headline.includes(key) || name.includes(key)) return value;
  }
  return null;
}

export async function syncTournamentScores(onProgress) {
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= todayStr);
  
  const allStats = {}; // { playerName: [{ points, roundName, gameId }] }
  const processedGameIds = new Set();
  const losingTeamIds = new Set();

  onProgress?.(`Syncing ${datesToFetch.length} days of data...`);

  for (const dateStr of datesToFetch) {
    // group 100 = NCAA Tournament specifically
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`;
    const res = await fetch(url);
    const { events = [] } = await res.json();

    for (const event of events) {
      if (processedGameIds.has(event.id)) continue;

      const roundName = getNormalizedRound(event);
      if (!roundName) continue; // Skips non-NCAA games (like conference leftovers)

      processedGameIds.add(event.id);

      // --- ELIMINATION LOGIC ---
      if (event.status?.type?.name === 'STATUS_FINAL') {
        const competitors = event.competitions?.[0]?.competitors || [];
        for (const c of competitors) {
          if (c.winner === false && c.team?.id) {
            losingTeamIds.add(String(c.team.id));
          }
        }
      }

      // --- POINT DATA LOGIC ---
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
              allStats[pName].push({ points: pts, roundName, gameId: event.id });
            }
          });
        });
      });
    }
  }

  // 1. Update Eliminations
  if (losingTeamIds.size > 0) {
    const { data: players } = await supabase.from('players').select('id, name, team, espn_team_id').eq('is_eliminated', false).not('espn_team_id', 'is', null);
    const toEliminate = players?.filter(p => losingTeamIds.has(String(p.espn_team_id))) || [];
    if (toEliminate.length > 0) {
      await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id));
      onProgress?.(`✓ Eliminated: ${toEliminate.map(p => `${p.name} (${p.team})`).join(', ')}`);
    }
  }

  // 2. Update Scores
  const { data: drafted } = await supabase.from('players').select('id, name').not('drafter_id', 'is', null);
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
        }
      }
    }
  }

  return { matched: [], unmatched: [] };
}