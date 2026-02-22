"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseMatchUrl } from "@/lib/utils";
import { Search } from "lucide-react";

export function UrlInputForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = url.trim();
    if (!trimmed) return;

    const parsed = parseMatchUrl(trimmed);
    if (!parsed) {
      setError(
        "Unrecognized URL. Paste a shootnscoreit.com match URL, e.g. https://shootnscoreit.com/event/22/26547/"
      );
      return;
    }

    router.push(`/match/${parsed.ct}/${parsed.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full max-w-xl">
      <div className="flex gap-2">
        <Input
          type="url"
          placeholder="https://shootnscoreit.com/event/22/26547/"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          className="flex-1"
          aria-label="Match URL"
        />
        <Button type="submit" aria-label="Load match">
          <Search className="w-4 h-4 mr-2" />
          Load
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
