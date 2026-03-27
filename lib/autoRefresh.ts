export const AUTO_REFRESH_INTERVAL_MS = 5_000;
export const SOFT_REFRESH_EVENT = "zapmarket:soft-refresh";
export const EXCLUDED_AUTO_REFRESH_PATHS = new Set(["/login"]);

type SoftRefreshDetail = {
  pathname: string;
  timestamp: number;
};

export function dispatchSoftRefresh(pathname: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<SoftRefreshDetail>(SOFT_REFRESH_EVENT, {
      detail: {
        pathname,
        timestamp: Date.now(),
      },
    }),
  );
}

export function subscribeToSoftRefresh(listener: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleEvent: EventListener = () => {
    listener();
  };

  window.addEventListener(SOFT_REFRESH_EVENT, handleEvent);

  return () => {
    window.removeEventListener(SOFT_REFRESH_EVENT, handleEvent);
  };
}
