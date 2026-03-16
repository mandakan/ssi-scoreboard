// Static HTML pages served by the Worker.
// Minimal, self-contained pages — no external CSS/JS dependencies.

const BRAND_COLOR = "#5865F2"; // Discord blurple
const BASE_URL = "https://rangeofficer.urdr.dev";
const SCOREBOARD_URL = "https://scoreboard.urdr.dev";

/** Shared HTML shell with embedded styles. */
function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #1a1a2e; color: #e0e0e0; line-height: 1.6;
      min-height: 100vh; display: flex; flex-direction: column;
    }
    main { flex: 1; max-width: 640px; margin: 0 auto; padding: 2rem 1.25rem; width: 100%; }
    h1 { color: ${BRAND_COLOR}; font-size: 1.75rem; margin-bottom: 0.5rem; }
    h2 { color: #b0b0d0; font-size: 1.15rem; margin: 1.75rem 0 0.5rem; }
    p, li { margin-bottom: 0.5rem; }
    ul { padding-left: 1.25rem; }
    a { color: ${BRAND_COLOR}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #2a2a4a; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
    .hero { text-align: center; margin-bottom: 2rem; }
    .hero p { color: #a0a0c0; font-size: 1.05rem; }
    .btn {
      display: inline-block; background: ${BRAND_COLOR}; color: #fff;
      padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600;
      font-size: 1rem; margin-top: 1rem; transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; text-decoration: none; }
    .commands { list-style: none; padding: 0; }
    .commands li { padding: 0.5rem 0; border-bottom: 1px solid #2a2a4a; }
    .commands code { color: ${BRAND_COLOR}; background: none; font-weight: 600; }
    .badge {
      display: inline-block; font-size: 0.7rem; font-weight: 600;
      padding: 0.1em 0.45em; border-radius: 3px; vertical-align: middle;
      margin-left: 0.4em; letter-spacing: 0.02em;
    }
    .badge-ephemeral { background: #2a2a4a; color: #a0a0c0; }
    .badge-public { background: #22c55e22; color: #4ade80; }
    .badge-server { background: #f59e0b22; color: #fbbf24; }
    .section-note { color: #888; font-size: 0.9rem; margin-bottom: 0.75rem; }
    footer {
      text-align: center; padding: 1.5rem 1rem; color: #666;
      font-size: 0.85rem; border-top: 1px solid #2a2a4a;
    }
    footer a { color: #888; }
  </style>
</head>
<body>
  <main>${body}</main>
  <footer>
    <a href="${BASE_URL}">Home</a> &middot;
    <a href="${BASE_URL}/privacy">Privacy</a> &middot;
    <a href="${BASE_URL}/tos">Terms</a> &middot;
    Powered by <a href="${SCOREBOARD_URL}">SSI Scoreboard</a>
  </footer>
</body>
</html>`;
}

/** GET / — Landing page */
export function landingPage(): string {
  return layout(
    "Range Officer — IPSC Match Bot for Discord",
    `
    <div class="hero">
      <h1>Range Officer</h1>
      <p>An IPSC match bot for Discord, powered by SSI Scoreboard.</p>
      <a class="btn" href="${BASE_URL}/invite">Add to Discord</a>
    </div>

    <h2>What it does</h2>
    <p>Range Officer brings IPSC competition data into your Discord server.
    Look up match results, track live scoring, compare shooters, and get
    daily reminders about upcoming matches — all without leaving Discord.</p>

    <h2>Look up matches &amp; shooters</h2>
    <p class="section-note">Anyone can run these. Results are posted in the channel for everyone to see.</p>
    <ul class="commands">
      <li><code>/match &lt;query&gt;</code> Search for a match and see its overview — stages, competitors, scoring status <span class="badge badge-public">visible to all</span></li>
      <li><code>/shooter &lt;name&gt;</code> Look up any shooter's cross-competition stats and achievements <span class="badge badge-public">visible to all</span></li>
      <li><code>/summary &lt;query&gt;</code> Per-stage breakdown for linked shooters in a match — HF, hit counts, % vs leader <span class="badge badge-public">visible to all</span></li>
      <li><code>/leaderboard &lt;query&gt;</code> Who's leading among linked shooters? Overall ranking + stage winners <span class="badge badge-public">visible to all</span></li>
    </ul>

    <h2>Your shooter profile</h2>
    <p class="section-note">These commands are based on your linked account. Responses are only visible to you.</p>
    <ul class="commands">
      <li><code>/link &lt;name&gt;</code> Connect your Discord account to your SSI shooter profile <span class="badge badge-ephemeral">only you</span></li>
      <li><code>/unlink</code> Disconnect your Discord account from your shooter profile <span class="badge badge-ephemeral">only you</span></li>
      <li><code>/me</code> View your personal dashboard — stats, achievements, upcoming matches (requires <code>/link</code> first) <span class="badge badge-ephemeral">only you</span></li>
    </ul>

    <h2>Server-wide features</h2>
    <p class="section-note">Configured once per server by any member. Reminders and notifications are posted
    in the channel where they were set up. <strong>These commands ping people</strong> — make sure
    your server is on board before enabling them.</p>
    <ul class="commands">
      <li><code>/watch &lt;query&gt;</code> Watch a live match — posts score updates in this channel when linked shooters finish a stage <span class="badge badge-server">server-wide</span></li>
      <li><code>/unwatch</code> Stop watching the current match <span class="badge badge-server">server-wide</span></li>
      <li><code>/remind-registrations set</code> Daily digest of upcoming matches with registration status. Filter by country, level, discipline, and lookahead window. <strong>Pings @here</strong> when a match opens registration that day — everyone in the channel gets notified <span class="badge badge-server">server-wide · @here</span></li>
      <li><code>/remind-squads set</code> Reminds linked shooters before squadding opens and on match day, with squad assignments. <strong>@mentions each linked user by name</strong> — only people who used <code>/link</code> get pinged <span class="badge badge-server">server-wide · @mentions</span></li>
    </ul>

    <h2>Personal reminders</h2>
    <p class="section-note">Track specific matches and get DM reminders when registration opens,
    squadding opens, or match day arrives. No server setup needed — these are just for you.</p>
    <ul class="commands">
      <li><code>/remind set &lt;match&gt;</code> Add a personal reminder for a match (up to 20 active) <span class="badge badge-ephemeral">only you · DM</span></li>
      <li><code>/remind list</code> View your active reminders <span class="badge badge-ephemeral">only you</span></li>
      <li><code>/remind cancel &lt;match&gt;</code> Remove a reminder <span class="badge badge-ephemeral">only you</span></li>
    </ul>

    <h2>Utility</h2>
    <ul class="commands">
      <li><code>/introduction</code> Let the Range Officer introduce himself to the channel — great for onboarding new members <span class="badge badge-public">visible to all</span></li>
      <li><code>/help</code> Show all commands and getting-started instructions <span class="badge badge-ephemeral">only you</span></li>
    </ul>

    <h2>Getting started</h2>
    <p>1. <a href="${BASE_URL}/invite">Add Range Officer</a> to your server.</p>
    <p>2. Use <code>/link &lt;your name&gt;</code> to connect your shooter profile.</p>
    <p>3. Use <code>/me</code> to see your dashboard. That's it!</p>

    <h2>Data source</h2>
    <p>All match data comes from <a href="https://shootnscoreit.com">ShootNScoreIt</a>
    via <a href="${SCOREBOARD_URL}">SSI Scoreboard</a>. Range Officer does not store
    match results — it queries them on demand.</p>
    `,
  );
}

/** GET /privacy — Privacy policy */
export function privacyPage(): string {
  return layout(
    "Privacy Policy — Range Officer",
    `
    <h1>Privacy Policy</h1>
    <p>Last updated: March 2026</p>

    <h2>What data we collect</h2>
    <p>When you use the <code>/link</code> command, Range Officer stores a mapping
    between your Discord user ID and your SSI shooter ID. This is the only
    personal data we store.</p>

    <h2>Where data is stored</h2>
    <p>All data is stored in <a href="https://developers.cloudflare.com/kv/">Cloudflare
    Workers KV</a>, scoped per Discord server (guild). Your link in one server
    is not visible to other servers.</p>

    <h2>What we do not collect</h2>
    <ul>
      <li>We do not read or store message content.</li>
      <li>We do not track users across servers.</li>
      <li>We do not use analytics, cookies, or tracking pixels.</li>
      <li>We do not share data with third parties.</li>
    </ul>

    <h2>Match data</h2>
    <p>Match results and shooter statistics are fetched on demand from
    <a href="https://shootnscoreit.com">ShootNScoreIt</a> via
    <a href="${SCOREBOARD_URL}">SSI Scoreboard</a>.
    We do not store match data in the bot.</p>

    <h2>How to delete your data</h2>
    <ul>
      <li>Run <code>/link</code> again with a different name to overwrite your link.</li>
      <li>If the bot is removed from a server, all guild-scoped data is retained
      in KV but becomes inaccessible. Contact us to request deletion.</li>
    </ul>

    <h2>Children's privacy</h2>
    <p>Range Officer is not directed at children under 13. We do not knowingly
    collect data from children under 13.</p>

    <h2>Contact</h2>
    <p>For privacy questions, open an issue on the
    <a href="https://github.com/mandakan/ssi-scoreboard">GitHub repository</a>.</p>
    `,
  );
}

/** GET /tos — Terms of service */
export function tosPage(): string {
  return layout(
    "Terms of Service — Range Officer",
    `
    <h1>Terms of Service</h1>
    <p>Last updated: March 2026</p>

    <h2>Acceptance</h2>
    <p>By adding Range Officer to your Discord server or using its commands,
    you agree to these terms.</p>

    <h2>What Range Officer does</h2>
    <p>Range Officer is a Discord bot that retrieves IPSC competition data from
    <a href="https://shootnscoreit.com">ShootNScoreIt</a> via
    <a href="${SCOREBOARD_URL}">SSI Scoreboard</a> and displays it
    in Discord. It does not modify any external data.</p>

    <h2>No guarantees</h2>
    <ul>
      <li>Match data is provided "as is" from ShootNScoreIt. We do not guarantee
      accuracy, completeness, or timeliness.</li>
      <li>The bot may be unavailable due to maintenance, outages, or API changes.</li>
      <li>We reserve the right to modify or discontinue the service at any time.</li>
    </ul>

    <h2>Acceptable use</h2>
    <ul>
      <li>Do not use the bot to spam channels or abuse the underlying APIs.</li>
      <li>Do not attempt to extract data at scale through automated command usage.</li>
    </ul>

    <h2>Data source attribution</h2>
    <p>All competition data originates from
    <a href="https://shootnscoreit.com">ShootNScoreIt</a>.
    Range Officer is an independent project and is not affiliated with
    ShootNScoreIt.</p>

    <h2>Limitation of liability</h2>
    <p>Range Officer is provided free of charge, without warranty of any kind.
    The maintainers are not liable for any damages arising from its use.</p>

    <h2>Changes</h2>
    <p>We may update these terms at any time. Continued use of the bot
    constitutes acceptance of the updated terms.</p>

    <h2>Contact</h2>
    <p>For questions, open an issue on the
    <a href="https://github.com/mandakan/ssi-scoreboard">GitHub repository</a>.</p>
    `,
  );
}
