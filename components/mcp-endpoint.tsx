"use client";

import { useState } from "react";
import { Bot, Copy, Check } from "lucide-react";

const MCP_URL = "https://scoreboard.urdr.dev/api/mcp";

export function McpEndpoint() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(MCP_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-3 p-4 rounded-lg border border-border font-mono text-xs break-all">
      <Bot className="w-5 h-5 shrink-0 text-muted-foreground font-sans" aria-hidden="true" />
      <span className="flex-1 text-muted-foreground">{MCP_URL}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied!" : "Copy MCP endpoint URL"}
        className="shrink-0 p-2 -m-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        {copied
          ? <Check className="w-4 h-4" aria-hidden="true" />
          : <Copy className="w-4 h-4" aria-hidden="true" />
        }
      </button>
    </div>
  );
}
