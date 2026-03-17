// ESPN CDN logo URL: https://a.espncdn.com/i/teamlogos/ncaa/500/{id}.png
// Primary + secondary colors for each 2026 tournament team

const TEAM_BRANDING = {
  // ── 1-seeds ──────────────────────────────────────────────────────────────
  'Duke':         { espnId: 150,  primary: '#003087', secondary: '#FFFFFF' },
  'Arizona':      { espnId: 12,   primary: '#CC0033', secondary: '#003366' },
  'Michigan':     { espnId: 130,  primary: '#00274C', secondary: '#FFCB05' },
  'Florida':      { espnId: 57,   primary: '#0021A5', secondary: '#FA4616' },
  // ── 2-seeds ──────────────────────────────────────────────────────────────
  'UConn':        { espnId: 41,   primary: '#000E2F', secondary: '#E4002B' },
  'Connecticut':  { espnId: 41,   primary: '#000E2F', secondary: '#E4002B' },
  'Purdue':       { espnId: 2509, primary: '#CEB888', secondary: '#000000' },
  'Iowa St.':     { espnId: 66,   primary: '#C8102E', secondary: '#F1BE48' },
  'Houston':      { espnId: 248,  primary: '#C8102E', secondary: '#FFFFFF' },
  // ── 3-seeds ──────────────────────────────────────────────────────────────
  'Michigan St.': { espnId: 127,  primary: '#18453B', secondary: '#FFFFFF' },
  'Gonzaga':      { espnId: 2250, primary: '#002469', secondary: '#CC0000' },
  'Illinois':     { espnId: 356,  primary: '#E84A27', secondary: '#13294B' },
  'Virginia':     { espnId: 258,  primary: '#232D4B', secondary: '#F84C1E' },
  // ── 4-seeds ──────────────────────────────────────────────────────────────
  'Kansas':       { espnId: 2305, primary: '#0051A5', secondary: '#E8000D' },
  'Arkansas':     { espnId: 8,    primary: '#9D2235', secondary: '#FFFFFF' },
  'Alabama':      { espnId: 333,  primary: '#9E1B32', secondary: '#FFFFFF' },
  'Nebraska':     { espnId: 158,  primary: '#E41C38', secondary: '#FFFFFF' },
  // ── 5-seeds ──────────────────────────────────────────────────────────────
  "St. John's":   { espnId: 2599, primary: '#CC0000', secondary: '#FFFFFF' },
  'Wisconsin':    { espnId: 275,  primary: '#C5050C', secondary: '#FFFFFF' },
  'Texas Tech':   { espnId: 2641, primary: '#CC0000', secondary: '#000000' },
  'Vanderbilt':   { espnId: 238,  primary: '#866D4B', secondary: '#000000' },
  // ── 6-seeds ──────────────────────────────────────────────────────────────
  'Louisville':   { espnId: 97,   primary: '#AD0000', secondary: '#000000' },
  'BYU':          { espnId: 252,  primary: '#002E5D', secondary: '#FFFFFF' },
  'Tennessee':    { espnId: 2633, primary: '#FF8200', secondary: '#FFFFFF' },
  'North Carolina': { espnId: 153, primary: '#4B9CD3', secondary: '#FFFFFF' },
  // ── 7-seeds ──────────────────────────────────────────────────────────────
  'UCLA':         { espnId: 26,   primary: '#2D68C4', secondary: '#F2A900' },
  'Miami FL':     { espnId: 2390, primary: '#005030', secondary: '#F47321' },
  'Miami (FL)':   { espnId: 2390, primary: '#005030', secondary: '#F47321' },
  'Kentucky':     { espnId: 96,   primary: '#0033A0', secondary: '#FFFFFF' },
  "Saint Mary's": { espnId: 2608, primary: '#013283', secondary: '#CC0000' },
  // ── 8-seeds ──────────────────────────────────────────────────────────────
  'Ohio St.':     { espnId: 194,  primary: '#BB0000', secondary: '#666666' },
  'Villanova':    { espnId: 222,  primary: '#003E7E', secondary: '#FFFFFF' },
  'Clemson':      { espnId: 228,  primary: '#F56600', secondary: '#522D80' },
  'Georgia':      { espnId: 61,   primary: '#BA0C2F', secondary: '#000000' },
  // ── 9-seeds ──────────────────────────────────────────────────────────────
  'TCU':          { espnId: 2628, primary: '#4D1979', secondary: '#FFFFFF' },
  'Utah St.':     { espnId: 328,  primary: '#0F2439', secondary: '#8B734A' },
  'Iowa':         { espnId: 2294, primary: '#FFCD00', secondary: '#000000' },
  'Saint Louis':  { espnId: 139,  primary: '#003DA5', secondary: '#9E1B32' },
  // ── 10-seeds ─────────────────────────────────────────────────────────────
  'UCF':          { espnId: 2116, primary: '#BA9B37', secondary: '#000000' },
  'Missouri':     { espnId: 142,  primary: '#F1B82D', secondary: '#000000' },
  'Texas A&M':    { espnId: 245,  primary: '#500000', secondary: '#FFFFFF' },
  'Santa Clara':  { espnId: 2172, primary: '#862633', secondary: '#FFFFFF' },
  // ── 11-seeds ─────────────────────────────────────────────────────────────
  'South Florida':{ espnId: 58,   primary: '#006747', secondary: '#CFC493' },
  'NC State':     { espnId: 152,  primary: '#CC0000', secondary: '#FFFFFF' },
  'VCU':          { espnId: 2670, primary: '#FFB300', secondary: '#000000' },
  'SMU':          { espnId: 2567, primary: '#0033A0', secondary: '#C8102E' },
  'Texas':        { espnId: 251,  primary: '#BF5700', secondary: '#FFFFFF' },
  'Miami (Ohio)': { espnId: 193,  primary: '#B61E2E', secondary: '#FFFFFF' },
  // ── 12-seeds ─────────────────────────────────────────────────────────────
  'Northern Iowa':{ espnId: 2269, primary: '#4B116F', secondary: '#FFCC00' },
  'High Point':   { espnId: 2272, primary: '#4B0082', secondary: '#FFFFFF' },
  'McNeese':      { espnId: 2377, primary: '#005587', secondary: '#F0AB00' },
  'McNeese St.':  { espnId: 2377, primary: '#005587', secondary: '#F0AB00' },
  'Akron':        { espnId: 2006, primary: '#041E42', secondary: '#A89968' },
  // ── 13-seeds ─────────────────────────────────────────────────────────────
  'Cal Baptist':  { espnId: 2856, primary: '#002868', secondary: '#C8102E' },
  'Hawaii':       { espnId: 62,   primary: '#024731', secondary: '#FFFFFF' },
  'Troy':         { espnId: 2653, primary: '#8B0000', secondary: '#FFFFFF' },
  'Hofstra':      { espnId: 2273, primary: '#003591', secondary: '#F0AB00' },
  // ── 14-seeds ─────────────────────────────────────────────────────────────
  'North Dakota St.': { espnId: 2449, primary: '#005643', secondary: '#FFC72C' },
  'Penn':         { espnId: 219,  primary: '#011F5B', secondary: '#990000' },
  'Wright St.':   { espnId: 2751, primary: '#006338', secondary: '#FFFFFF' },
  // ── 15/16-seeds ──────────────────────────────────────────────────────────
  'Furman':       { espnId: 231,  primary: '#582C83', secondary: '#FFFFFF' },
  'Siena':        { espnId: 2561, primary: '#006338', secondary: '#FFC72C' },
  'Long Island':  { espnId: 2352, primary: '#00205B', secondary: '#FFFFFF' },
  'Queens (N.C.)':{ espnId: 2543, primary: '#006633', secondary: '#FFFFFF' },
  'Idaho':        { espnId: 70,   primary: '#B3A369', secondary: '#000000' },
  'Howard':       { espnId: 47,   primary: '#003A63', secondary: '#E51937' },
  'UMBC':         { espnId: 2439, primary: '#000000', secondary: '#F9C31F' },
  'Lehigh':       { espnId: 2350, primary: '#653600', secondary: '#FFFFFF' },
  'Prairie View A&M': { espnId: 2507, primary: '#461D7C', secondary: '#FDD023' },
  'Tennessee St.':{ espnId: 2634, primary: '#4E2583', secondary: '#FFFFFF' },
  'Kennesaw St.': { espnId: 338,  primary: '#FDBB30', secondary: '#000000' },
}

export function getTeamBranding(teamName) {
  if (!teamName) return null
  // Direct match
  if (TEAM_BRANDING[teamName]) return TEAM_BRANDING[teamName]
  // Case-insensitive fallback
  const lower = teamName.toLowerCase()
  for (const [key, val] of Object.entries(TEAM_BRANDING)) {
    if (key.toLowerCase() === lower) return val
  }
  return null
}

export function getLogoUrl(teamName) {
  const branding = getTeamBranding(teamName)
  if (!branding) return null
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${branding.espnId}.png`
}
