/**
 * Institution helpers shared by Home (LivePlaidDashboard) and the Accounts
 * page: bank website lookup and the brand colour / initials used for the
 * avatar circles. Moved out of LivePlaidDashboard.tsx unchanged.
 */
// ── Institution website lookup ──────────────────────────────────
const INST_URLS: Record<string, string> = {
  "chase": "https://chase.com", "jpmorgan": "https://chase.com",
  "bank of america": "https://bankofamerica.com", "bofa": "https://bankofamerica.com",
  "wells fargo": "https://wellsfargo.com",
  "citibank": "https://citi.com", "citi": "https://citi.com",
  "capital one": "https://capitalone.com",
  "american express": "https://americanexpress.com", "amex": "https://americanexpress.com",
  "discover": "https://discover.com",
  "ally": "https://ally.com",
  "marcus": "https://marcus.com",
  "synchrony": "https://mysynchrony.com",
  "us bank": "https://usbank.com",
  "pnc": "https://pnc.com",
  "td bank": "https://tdbank.com",
  "fidelity": "https://fidelity.com",
  "vanguard": "https://vanguard.com",
  "schwab": "https://schwab.com",
  "robinhood": "https://robinhood.com",
  "sofi": "https://sofi.com",
  "navy federal": "https://navyfederal.org",
  "usaa": "https://usaa.com",
  "goldman sachs": "https://marcus.com",
  "apple": "https://applecash.com",
  "paypal": "https://paypal.com",
  "venmo": "https://venmo.com",
  "nelnet": "https://nelnet.com",
  "sallie mae": "https://salliemae.com",
  "lively": "https://livelyme.com",
};

export const getInstitutionUrl = (name: string | null, customUrl?: string): string | null => {
  if (customUrl) return customUrl;
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [key, url] of Object.entries(INST_URLS)) {
    if (lower.includes(key)) return url;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(name + " bank login")}`;
};

// ── Bank colors & abbreviated names (no external logo fetch needed) ───────────
const BANK_BRANDS: [string, { color: string; bg: string; abbr: string }][] = [
  ["chase",           { color:"#fff", bg:"#1d6fa5", abbr:"C"  }],
  ["jpmorgan",        { color:"#fff", bg:"#1d6fa5", abbr:"JP" }],
  ["bank of america", { color:"#fff", bg:"#e31837", abbr:"BA" }],
  ["bofa",            { color:"#fff", bg:"#e31837", abbr:"BA" }],
  ["wells fargo",     { color:"#fff", bg:"#cc0000", abbr:"WF" }],
  ["citibank",        { color:"#fff", bg:"#003b8e", abbr:"C"  }],
  ["citi",            { color:"#fff", bg:"#003b8e", abbr:"C"  }],
  ["capital one",     { color:"#fff", bg:"#d03027", abbr:"C1" }],
  ["american express",{ color:"#fff", bg:"#016fd0", abbr:"AX" }],
  ["amex",            { color:"#fff", bg:"#016fd0", abbr:"AX" }],
  ["discover",        { color:"#fff", bg:"#f76400", abbr:"D"  }],
  ["ally",            { color:"#fff", bg:"#6e3aff", abbr:"A"  }],
  ["usaa",            { color:"#fff", bg:"#003087", abbr:"U"  }],
  ["navy federal",    { color:"#fff", bg:"#003087", abbr:"NF" }],
  ["td bank",         { color:"#fff", bg:"#34b233", abbr:"TD" }],
  ["us bank",         { color:"#fff", bg:"#002868", abbr:"US" }],
  ["pnc",             { color:"#fff", bg:"#f58025", abbr:"P"  }],
  ["truist",          { color:"#fff", bg:"#6b0099", abbr:"T"  }],
  ["suntrust",        { color:"#fff", bg:"#6b0099", abbr:"ST" }],
  ["regions",         { color:"#fff", bg:"#005b30", abbr:"R"  }],
  ["fifth third",     { color:"#fff", bg:"#003366", abbr:"53" }],
  ["citizens",        { color:"#fff", bg:"#009947", abbr:"CB" }],
  ["marcus",          { color:"#fff", bg:"#8347ad", abbr:"M"  }],
  ["goldman",         { color:"#fff", bg:"#2c2c2c", abbr:"GS" }],
  ["synchrony",       { color:"#fff", bg:"#2f578f", abbr:"SY" }],
  ["barclays",        { color:"#fff", bg:"#00aeef", abbr:"BA" }],
  ["robinhood",       { color:"#fff", bg:"#00c805", abbr:"RH" }],
  ["fidelity",        { color:"#fff", bg:"#538234", abbr:"F"  }],
  ["vanguard",        { color:"#fff", bg:"#951415", abbr:"V"  }],
  ["schwab",          { color:"#fff", bg:"#00a9e0", abbr:"CS" }],
  ["sofi",            { color:"#fff", bg:"#7b2d8b", abbr:"SF" }],
  ["chime",           { color:"#fff", bg:"#38c172", abbr:"CH" }],
  ["paypal",          { color:"#fff", bg:"#003087", abbr:"PP" }],
  ["venmo",           { color:"#fff", bg:"#3d95ce", abbr:"V"  }],
  ["apple",           { color:"#fff", bg:"#555555", abbr:"AP" }],
  ["coinbase",        { color:"#fff", bg:"#0052ff", abbr:"CB" }],
  ["betterment",      { color:"#fff", bg:"#0f7cf0", abbr:"BT" }],
  ["wealthfront",     { color:"#fff", bg:"#00afc1", abbr:"WF" }],
  ["acorns",          { color:"#fff", bg:"#3aa74c", abbr:"AC" }],
  ["nelnet",          { color:"#fff", bg:"#003da5", abbr:"NL" }],
  ["sallie mae",      { color:"#fff", bg:"#0063a5", abbr:"SM" }],
  ["truist",          { color:"#fff", bg:"#6b0099", abbr:"TR" }],
];

export function getBankBrand(instName: string): { color: string; bg: string; abbr: string } {
  const lower = instName.toLowerCase();
  for (const [key, brand] of BANK_BRANDS) {
    if (lower.includes(key)) return brand;
  }
  // Hash to a stable hue
  let hash = 0;
  for (let i = 0; i < lower.length; i++) hash = lower.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  const abbr = instName.slice(0,2).toUpperCase();
  return { color:"#fff", bg:`hsl(${hue} 55% 38%)`, abbr };
}
