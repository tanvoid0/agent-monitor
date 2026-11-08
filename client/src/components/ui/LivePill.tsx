/**
 * @file LivePill.tsx
 * @description Live/offline connection pill (`role="status"`) driven by the
 * `connected` prop — pulsing success badge when connected, neutral badge
 * otherwise. Before the socket has EVER connected (the few seconds right
 * after a fresh page load/navigation), shows a distinct "Connecting..."
 * state instead of "Offline" (#109) - the WS genuinely hasn't failed yet, so
 * labeling that window the same as an actual drop reads as broken.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "./Badge";

export function LivePill({ connected }: { connected: boolean }) {
  const { t } = useTranslation();
  const everConnectedRef = useRef(connected);
  if (connected) everConnectedRef.current = true;

  if (!connected && !everConnectedRef.current) {
    return (
      <span role="status">
        <Badge tone="neutral" size="xs" dot pulse>
          {t("common:connecting")}
        </Badge>
      </span>
    );
  }

  return (
    <span role="status">
      {connected ? (
        <Badge tone="success" size="xs" dot pulse>
          {t("common:live")}
        </Badge>
      ) : (
        <Badge tone="neutral" size="xs" dot>
          {t("common:offline")}
        </Badge>
      )}
    </span>
  );
}
