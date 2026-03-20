import { supabase } from './supabase.js'

const TOURNAMENT_DATES = [
  '20260317', '20260318', '20260319', '20260320', 
  '20260321', '20260322', '20260326', '20260327', 
  '20260328', '20260329', '20260404', '20260406'
]

// The "Source of Truth" for Round Names
const DATE_TO_ROUND = {
  '20260317': 'Play-In', '20260318': 'Play-In',
  '20260319': 'Round of 64', '20260320': 'Round of 64',
  '20260321': 'Round of 32', '20260322': 'Round of 32',
  '20260326': 'Sweet Sixteen', '20260327': 'Sweet Sixteen',
  '20260328': 'Elite Eight', '20260329': 'Elite Eight',
  '20260404': 'Final Four', '20260406': 'Championship'
}

// Robust Helper to Match Team Names (Fallback for missing IDs)
function teamsMatch(ourTeam, espnTeam) {
  if (!ourTeam || !espnTeam) return false;
  const a = ourTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = espnTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (a === b) return true;
  // Prevent common "Florida" vs "South Florida" overlap
  const prefixes = ['north', 'south', 'east', 'west', 'state', 'st', 'am'];
  for (const p of prefixes) {
    if (a.includes(p) !== b.includes(p)) return false;
  }
  return a.includes(b) || b.includes(a);
}

function detectRoundName(event, dateStr) {
  const headline = (event.notes?.[0]?.headline || '').toLowerCase();
  if (headline.includes('first four') || headline.includes('play-in')) return 'Play-In';
  if (headline.includes('first round') || headline.includes('round of 64')) return 'Round of 64';
  if (headline.includes('second round') || headline.includes('round of 32')) return 'Round of 32';
  if (headline.includes('sweet sixteen')) return 'Sweet Sixteen';
  if (headline.includes('elite eight')) return 'Elite Eight';
  if (headline.includes('final four')) return 'Final Four';
  if (headline.includes('championship') && !headline.includes('round')) return 'Championship';
  // Fallback to date-based round name
  return DATE_TO_ROUND[dateStr] || null;
}

async function autoEliminateLosers(completedEvents, onProgress) {
  const losers = new Set(); // Stores {id, name}
  for (const event of completedEvents) {
    const competitors = event.competitions?.[0]?.competitors || [];
    for (const c of competitors) {
      if (c.winner === false) {
        losers.add({ id: String(c.team.id), name: c.team?.displayName || '' });
      }
    }
  }

  if (losers.size === 0) return;

  const { data: players } = await supabase.from('players').select('id, name, team, espn_team_id').eq('is_eliminated', false);
  if (!players || players.length === 0) return;

  const toEliminate = players.filter(p => {
    for (const loser of losers) {
      // 1. If we have an ID, match strictly by ID (Safest)
      if (p.espn_team_id && p.espn_team_id === loser.id) return true;
      // 2. If we DON'T have an ID, fallback to name matching
      if (!p.espn_team_id && teamsMatch(p.team, loser.name)) return true;
    }
    return false;
  });

  if (toEliminate.length === 0) return;
  await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id));
  onProgress?.(`✓ Eliminated: ${toEliminate.map(p => p.name).join(', ')}`);
}

export async function syncTournamentScores(onProgress) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= today);
  const allStats = {}; 
  const completedEvents = [];
  const matched = []; const unmatched = [];

  for (const dateStr of datesToFetch) {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`);
    const { events = [] } = await res.json();

    for (const event of events) {
      const roundName = detectRoundName(event, dateStr);
      if (!roundName) continue;

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
              const pName = ath.athlete.displayName;
              if (!allStats[pName]) allStats[pName] = [];
              allStats[pName].push({ points: pts, roundName });
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
        matched.push(p.name);
      } else { unmatched.push(p.name); }
    }
  }
  await supabase.from('settings').upsert({ key: 'last_espn_sync', value: new Date().toISOString() });
  return { matched, unmatched };
}