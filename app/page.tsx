import { UrlInputForm } from "@/components/url-input-form";
import { RecentCompetitions } from "@/components/recent-competitions";
import { EventSearch } from "@/components/event-search";
import { Target } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center p-4 pt-8 sm:p-6 sm:pt-16 gap-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-3">
          <Target className="w-8 h-8 text-primary" />
          <h1 className="text-3xl font-bold">SSI Scoreboard</h1>
        </div>
        <p className="text-muted-foreground max-w-md">
          Live stage-by-stage competitor comparison for IPSC matches on{" "}
          <span className="font-medium">shootnscoreit.com</span>.
        </p>
      </div>

      <div className="w-full max-w-2xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">Browse competitions</p>
          <EventSearch />
          <p className="text-xs text-muted-foreground">
            IPSC handgun &amp; PCC — past 3 months and upcoming
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Or paste a match URL</p>
          <UrlInputForm />
          <p className="text-xs text-muted-foreground">
            Example:{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">
              https://shootnscoreit.com/event/22/26547/
            </code>
          </p>
        </div>
      </div>

      <RecentCompetitions />
    </main>
  );
}
