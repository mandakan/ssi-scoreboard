"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

interface Props {
  token: string;
}

export function RefreshButton({ token }: Props) {
  const router = useRouter();
  const [isFetching, setIsFetching] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const busy = isFetching || isPending;

  async function handleClick() {
    setError(null);
    setIsFetching(true);
    try {
      const res = await fetch("/api/admin/access/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetching(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleClick}
        disabled={busy}
        aria-label="Refresh access catalog from SSI"
      >
        {busy ? "refreshing..." : "refresh"}
      </Button>
      {error ? (
        <div role="alert" className="text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
