"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PWAInstallProvider } from "@/lib/pwa-install";
import { WhatsNewProvider } from "@/components/whats-new-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <PWAInstallProvider>
            <WhatsNewProvider>{children}</WhatsNewProvider>
          </PWAInstallProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
