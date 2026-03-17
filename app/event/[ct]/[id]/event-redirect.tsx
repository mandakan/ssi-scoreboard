"use client";

import { useEffect } from "react";

export function EventRedirect({ url }: { url: string }) {
  useEffect(() => {
    window.location.replace(url);
  }, [url]);

  return (
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
      }}
    >
      <p className="text-muted-foreground">
        Redirecting to{" "}
        <a href={url} className="text-primary underline">
          ShootNScoreIt
        </a>
        …
      </p>
    </main>
  );
}
