"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  AUTO_REFRESH_INTERVAL_MS,
  EXCLUDED_AUTO_REFRESH_PATHS,
  dispatchSoftRefresh,
} from "@/lib/autoRefresh";

export function GlobalAutoRefresh() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || EXCLUDED_AUTO_REFRESH_PATHS.has(pathname)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      dispatchSoftRefresh(pathname);
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pathname]);

  return null;
}
