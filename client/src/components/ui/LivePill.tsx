/**
 * @file LivePill.tsx
 * @description Live/offline connection pill (`role="status"`) driven purely by
 * the `connected` prop — pulsing success badge when connected, neutral badge
 * otherwise.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useTranslation } from "react-i18next";
import { Badge } from "./Badge";

export function LivePill({ connected }: { connected: boolean }) {
  const { t } = useTranslation();
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
