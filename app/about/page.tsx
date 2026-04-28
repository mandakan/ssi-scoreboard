import type { Metadata } from "next";
import Link from "next/link";
import { Github, Crosshair, Coffee } from "lucide-react";
import { McpEndpoint } from "@/components/mcp-endpoint";
import { InstallInstructions } from "@/components/install-instructions";

export const metadata: Metadata = {
  title: "About – SSI Scoreboard",
  description:
    "About SSI Scoreboard – a free, open-source stage-by-stage IPSC competitor comparison tool.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen flex flex-col items-center p-4 pt-8 sm:p-6 sm:pt-12">
      <div className="w-full max-w-2xl space-y-10">
        <div>
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            ← Back to SSI Scoreboard
          </Link>
        </div>

        <h1 className="text-2xl font-bold">About SSI Scoreboard</h1>

        <section aria-labelledby="about-what-heading" className="space-y-4">
          <h2
            id="about-what-heading"
            className="text-xl font-semibold border-b border-border pb-2"
          >
            What is this?
          </h2>
          <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
            <p>
              SSI Scoreboard is a free, open-source tool for comparing IPSC
              competitors stage by stage. Whether you&apos;re reviewing your own
              match after the fact, comparing scores with friends, or breaking
              down a squad&apos;s performance for coaching — this is the fastest way
              to get a clear picture.
            </p>
            <p>
              Match data is fetched from{" "}
              <a
                href="https://shootnscoreit.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
                aria-label="Shoot'n Score It (opens in new tab)"
              >
                ShootNScoreIt
              </a>
              , the scoring platform used at IPSC competitions across Scandinavia
              and beyond. SSI Scoreboard is an independent application and is not
              affiliated with or endorsed by ShootNScoreIt.
            </p>
          </div>
        </section>

        <section aria-labelledby="about-features-heading" className="space-y-4">
          <h2
            id="about-features-heading"
            className="text-xl font-semibold border-b border-border pb-2"
          >
            Features
          </h2>
          <div className="text-sm leading-relaxed text-muted-foreground space-y-4">
            <div>
              <h3 className="font-medium text-foreground mb-2">
                Find and compare
              </h3>
              <ul className="space-y-2 list-disc list-inside">
                <li>
                  Search competitions by name, country, level, or date range,
                  and see which matches are live right now
                </li>
                <li>
                  Compare up to 12 competitors side-by-side across every stage,
                  with favorites pinned to the top of the picker and one-tap
                  Clear / Undo
                </li>
                <li>
                  Smart benchmark presets — once you set &quot;this is me&quot;
                  in My Shooters, one tap selects the person above or below
                  you in your division, the division podium, your percentile
                  cohort (p25/p50/p75/p95), or peers from the same club
                </li>
                <li>
                  Replace your selection with an entire IPSC squad in one tap,
                  with a five-second undo if you change your mind
                </li>
                <li>
                  Live, Pre-match, and Coaching views — auto-selected to match
                  the phase of the event, with a manual override
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-foreground mb-2">
                Before the match
              </h3>
              <ul className="space-y-2 list-disc list-inside">
                <li>
                  Pre-match view with the IPSC stage rotation for your squad,
                  course details, and constraint badges (strong hand, weak
                  hand, moving target, unloaded start)
                </li>
                <li>
                  Match-day weather forecast when the venue has coordinates
                </li>
                <li>
                  Registered field grouped by division, with your tracked
                  shooters highlighted
                </li>
                <li>
                  Personalised AI prep brief based on your historical
                  performance and the stage breakdown
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-foreground mb-2">
                After the match
              </h3>
              <ul className="space-y-2 list-disc list-inside">
                <li>
                  HF Level, stage archetype (Speed / Precision / Mixed), and
                  course-length / constraint breakdowns
                </li>
                <li>
                  Stage degradation analysis — see whether shooting early or
                  late on a stage correlated with performance
                </li>
                <li>
                  Conditions overlay — per-cell weather, time-of-day, and wind
                  for stages your squad shot at different times
                </li>
                <li>
                  Style fingerprint and division position chart for spotting
                  strengths and weaknesses
                </li>
                <li>
                  Stage simulator — tweak times and hits to see how your
                  ranking would have changed, with full-field rank
                </li>
                <li>
                  AI coaching tips, plus a Roast mode for a humorous take
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-foreground mb-2">
                Your career
              </h3>
              <ul className="space-y-2 list-disc list-inside">
                <li>
                  Shooter dashboard with cross-match performance trends, A-zone
                  rate, consistency, and division-aware filters
                </li>
                <li>
                  Achievement ladders covering experience, accuracy, and
                  variety milestones
                </li>
                <li>
                  Claim &quot;this is me&quot; and the app auto-selects you in
                  every match you&apos;ve competed in
                </li>
                <li>
                  Track other shooters with one tap — they&apos;re auto-selected
                  too, so you never have to search again
                </li>
                <li>
                  Find any shooter by name and jump straight to their dashboard
                </li>
                <li>
                  Upcoming-match action cards: register, pick your squad, or
                  just show up — with countdown badges and direct SSI links
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-foreground mb-2">
                Share, sync, install
              </h3>
              <ul className="space-y-2 list-disc list-inside">
                <li>
                  Share a comparison in one tap — the link encodes your
                  competitor selection so the recipient sees the same view
                </li>
                <li>
                  Sync identity, tracked shooters, and recent matches to
                  another device with a 6-character code or QR scan. No
                  account needed.
                </li>
                <li>
                  Install as a Progressive Web App for fullscreen, native-app
                  feel courtside
                </li>
                <li>
                  Discord bot with <code>/remind upcoming</code> for a personal
                  action checklist on registration deadlines and squad picks
                </li>
                <li>
                  Colorblind-safe palette, shape-coded chart markers, and
                  WCAG 2.1 AA accessibility throughout
                </li>
                <li>No login required — paste a match URL and go</li>
              </ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="about-ai-heading" className="space-y-4">
          <h2
            id="about-ai-heading"
            className="text-xl font-semibold border-b border-border pb-2"
          >
            Use with AI assistants
          </h2>
          <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
            <p>
              SSI Scoreboard exposes an{" "}
              <a
                href="https://modelcontextprotocol.io"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
                aria-label="Model Context Protocol (opens in new tab)"
              >
                MCP
              </a>{" "}
              server so you can query competition data directly inside Claude or
              any other MCP-compatible AI assistant. Ask it to find upcoming
              matches, compare competitors, or summarise stage-by-stage
              performance — all in natural language.
            </p>
            <p>
              Point your AI client at the HTTP endpoint and it will have access
              to six tools: <strong>search_events</strong>,{" "}
              <strong>get_match</strong>,{" "}
              <strong>compare_competitors</strong>,{" "}
              <strong>get_popular_matches</strong>,{" "}
              <strong>find_shooter</strong>, and{" "}
              <strong>get_shooter_dashboard</strong>.
            </p>
          </div>
          <McpEndpoint />
        </section>

        <section aria-labelledby="about-links-heading" className="space-y-4">
          <h2
            id="about-links-heading"
            className="text-xl font-semibold border-b border-border pb-2"
          >
            Links
          </h2>
          <div className="flex flex-col gap-3">
            <a
              href="https://github.com/mandakan/ssi-scoreboard"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-accent hover:text-accent-foreground transition-colors"
              aria-label="Source code on GitHub (opens in new tab)"
            >
              <Github className="w-5 h-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium text-sm">GitHub</p>
                <p className="text-xs text-muted-foreground">
                  View the source code, report issues, or contribute
                </p>
              </div>
            </a>
            <a
              href="https://shootnscoreit.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-accent hover:text-accent-foreground transition-colors"
              aria-label="Shoot'n Score It (opens in new tab)"
            >
              <Crosshair className="w-5 h-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium text-sm">Shoot&apos;n Score It</p>
                <p className="text-xs text-muted-foreground">
                  The match scoring platform powering this app
                </p>
              </div>
            </a>
            <a
              href="https://www.buymeacoffee.com/thias"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-4 rounded-lg border border-[#FFDD00] bg-[#FFDD00]/10 hover:bg-[#FFDD00]/20 text-foreground transition-colors"
              aria-label="Buy me a coffee on Buy Me a Coffee (opens in new tab)"
            >
              <Coffee className="w-5 h-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium text-sm">Buy me a coffee</p>
                <p className="text-xs text-muted-foreground">
                  If this tool is useful to you, a coffee is always appreciated!
                </p>
              </div>
            </a>
          </div>
        </section>

        <section id="install" aria-labelledby="about-install-heading" className="space-y-4">
          <h2
            id="about-install-heading"
            className="text-xl font-semibold border-b border-border pb-2"
          >
            Install as an app
          </h2>
          <p className="text-sm text-muted-foreground">
            SSI Scoreboard is a Progressive Web App — you can add it to your
            home screen for instant courtside access, fullscreen view, and a
            native-app feel. No app store required.
          </p>
          <InstallInstructions />
        </section>

        <section aria-labelledby="about-built-heading" className="space-y-4">
          <h2
            id="about-built-heading"
            className="text-xl font-semibold border-b border-border pb-2"
          >
            Built with
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Next.js 16, React, Tailwind CSS v4, shadcn/ui, TanStack Query v5,
            Redis for hot caching, and SQLite or Cloudflare D1 for the public
            match index and aggregated competition statistics. Your identity
            and tracked-shooter selections live only in your browser — see the
            Privacy Policy for details. Open source — contributions welcome.
          </p>
        </section>
      </div>
    </main>
  );
}
