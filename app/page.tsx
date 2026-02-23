import { RecentCompetitions } from "@/components/recent-competitions";
import { EventSearch } from "@/components/event-search";
import { Target } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center p-4 pt-8 sm:p-6 sm:pt-16 gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            SSI Scoreboard
          </span>
        </div>
        <h1 className="text-3xl font-bold leading-tight">
          Who&rsquo;s leading&nbsp;&mdash;
          <br />
          stage by stage.
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          Instant scoreboard breakdowns for any ShootNScoreIt match.
        </p>
      </div>

      <div className="w-full max-w-2xl flex flex-col gap-2">
        <EventSearch />
        <p className="text-xs text-muted-foreground text-center">
          Search by name, or paste a shootnscoreit.com match URL
        </p>
      </div>

      <RecentCompetitions />
    </main>
  );
}
