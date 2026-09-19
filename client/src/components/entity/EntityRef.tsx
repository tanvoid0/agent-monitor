/**
 * @file EntityRef.tsx
 * @description The one "link by reference" chip: a react-router `<Link>` to an
 * entity's primary page (session, agent, project, tool, event type, model or
 * event) with the full raw value as `title`, a default label per kind, and a
 * built-in right-click / long-press menu from `entityMenu`. A transient
 * session (pre-identity Codex process) renders a plain span with no link and
 * no menu.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import type { MouseEvent, ReactNode } from "react";
import type { TFunction } from "i18next";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { copyText } from "../../lib/clipboard";
import { ContextMenuFor } from "../ui";
import { projectParts } from "../../lib/project";
import { entityHref, entityMenu, entityValue, type EntityTarget } from "./entityMenu";

export type EntityRefProps = EntityTarget & {
  /** Id-fallback truncation; `0` keeps the full id. */
  chars?: number;
  /** Monospace 11px chip (default); `false` inherits the surrounding font. */
  mono?: boolean;
  className?: string;
  /** Custom label, e.g. `formatModelName(model)`. */
  children?: ReactNode;
  /** Attach the entity context menu; default true. */
  menu?: boolean;
  /** Keep the link out of tab order, e.g. inside an already-tabbable row; default true. */
  tabbable?: boolean;
  /** Render a plain span instead of a link (e.g. on the entity's own page); the menu stays. Default true. */
  link?: boolean;
};

const chipClass = "text-gray-300 truncate max-w-full";
const linkClass = "hover:text-gray-100 hover:underline decoration-dotted underline-offset-2";

function defaultLabel(ref: EntityTarget, chars: number, t: TFunction): ReactNode {
  const short = (id: string) => (chars > 0 ? id.slice(0, chars) : id);
  switch (ref.kind) {
    case "session":
      return ref.name || `${t("sessions:defaultName")}${short(ref.id)}`;
    case "agent":
      return ref.name || ref.type || short(ref.id);
    case "project": {
      const { label, sub } = projectParts(ref.cwd);
      return sub ? (
        <>
          {label}
          <span className="opacity-60"> · {sub}</span>
        </>
      ) : (
        label
      );
    }
    case "tool":
      return ref.name;
    case "eventType":
      return ref.type;
    case "model":
      return ref.model;
    case "event":
      return `#${ref.id}`;
  }
}

export function EntityRef(props: EntityRefProps) {
  const {
    chars = 8,
    mono = true,
    className,
    children,
    menu = true,
    tabbable = true,
    link: asLink = true,
  } = props;
  const { t } = useTranslation();
  const value = entityValue(props);
  const label = children ?? defaultLabel(props, chars, t);
  const font = mono && "font-mono text-[11px]";

  if (props.kind === "session" && props.transient) {
    return (
      <span className={cn(font, chipClass, className)} title={value}>
        {label}
      </span>
    );
  }

  // Keep an enclosing Clickable's menu closed when this chip opens its own;
  // a chip without a menu lets the row's menu through.
  const onContextMenu = menu ? (e: MouseEvent) => e.stopPropagation() : undefined;
  const link = asLink ? (
    <Link
      to={entityHref(props)}
      title={value}
      className={cn(font, chipClass, linkClass, className)}
      tabIndex={tabbable ? undefined : -1}
      onContextMenu={onContextMenu}
    >
      {label}
    </Link>
  ) : (
    <span className={cn(font, chipClass, className)} title={value} onContextMenu={onContextMenu}>
      {label}
    </span>
  );
  if (!menu) return link;
  return <ContextMenuFor items={entityMenu(props, { t, copy: copyText })}>{link}</ContextMenuFor>;
}
