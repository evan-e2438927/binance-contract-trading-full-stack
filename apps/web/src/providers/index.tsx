"use client";

import { Toaster } from "@binance-contract-trading-full-stack/ui/components/sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

import { createQueryClient } from "@/lib/query/query-client";

import { ThemeProvider } from "./theme-provider";
import { WsBridge } from "./ws-bridge";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    // 只做暗色（设计定稿），强制 dark，不跟随系统
    <ThemeProvider attribute="class" forcedTheme="dark" disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <WsBridge />
        {children}
        <Toaster position="top-center" richColors />
        {process.env.NODE_ENV === "development" && <ReactQueryDevtools buttonPosition="bottom-left" />}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
