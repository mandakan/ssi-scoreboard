import { UrlInputForm } from "@/components/url-input-form";
import { Target } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-3">
          <Target className="w-8 h-8 text-primary" />
          <h1 className="text-3xl font-bold">SSI Scoreboard</h1>
        </div>
        <p className="text-muted-foreground max-w-md">
          Live stage-by-stage competitor comparison for IPSC matches on{" "}
          <span className="font-medium">shootnscoreit.com</span>.
          <br />
          Paste a match URL to get started.
        </p>
      </div>

      <UrlInputForm />

      <p className="text-xs text-muted-foreground">
        Example:{" "}
        <code className="bg-muted px-1 py-0.5 rounded text-xs">
          https://shootnscoreit.com/event/22/26547/
        </code>
      </p>
    </main>
  );
}
