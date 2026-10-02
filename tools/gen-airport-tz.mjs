// Regenerates the <script id="airportTz"> block embedded in RoasterICS.html.
//
//   curl -sSLO https://raw.githubusercontent.com/mwgg/Airports/master/airports.json
//   node tools/gen-airport-tz.mjs airports.json > airportTz.block.html
//
// then replace the existing block (comment + <script id="airportTz">…</script>) with the output.
import fs from 'fs';

const all = Object.values(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
const byZone = {};
const zoneOk = {};
for (const a of all) {
  if (!/^[A-Z]{3}$/.test(a.iata || '') || !a.tz) continue;
  if (!(a.tz in zoneOk)) {
    try { new Intl.DateTimeFormat('en', { timeZone: a.tz }); zoneOk[a.tz] = true; } catch { zoneOk[a.tz] = false; }
  }
  if (zoneOk[a.tz]) (byZone[a.tz] ||= []).push(a.iata);
}

const lines = Object.keys(byZone).sort()
  .map(z => `${JSON.stringify(z)}:${JSON.stringify(byZone[z].sort().join(' '))}`);

process.stdout.write(`<!-- Airport IATA code → IANA timezone. Data from https://github.com/mwgg/Airports,
     Copyright (c) 2014 mwgg, MIT License. Regenerate with tools/gen-airport-tz.mjs rather than hand-edit. -->
<script id="airportTz" type="application/json">{
${lines.join(',\n')}
}</script>
`);
