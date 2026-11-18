# UI kit + navigation contract (v2 — post-critique, shadcn/Radix pattern)

Repo: D:/projects/production/ai/agentic-ai/agent-monitor — client at `client/src` (React 19.2, react-router 8.3, Tailwind 3.4, lucide-react, i18next, Vitest+Testing Library, jsdom). Dark theme only. Tokens in `client/tailwind.config.js` (surface-0..5, border, border-light, accent/accent-hover/accent-muted). Legacy CSS classes `.card .card-hover .btn-primary .btn-ghost .badge .input` in `client/src/index.css` STAY (untouched call sites keep working).

**The working tree already has uncommitted user changes (ProjectBadge, open-cwd, kanban i18n, README mirrors…). Never run `git stash`, `git checkout --`, `git restore`, `git reset`, or reformat files you do not own. Only edit files in your ownership list.**

Every new/edited `.ts/.tsx/.css/.js` file starts with the header (after a shebang if any):
```
/**
 * @file <Name>.tsx
 * @description <truthful overview of what the file does>
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
```
No MODULE_GUIDE / EXPORT CATALOG boilerplate in new files. Prettier: printWidth 100, double quotes, semi, trailingComma es5, LF. `tsconfig` has `isolatedModules: true` → barrels use `export type { … }` for types. No `@/` alias exists — use relative imports.

All user-visible strings via `useTranslation()`. New keys go in `client/src/i18n/locales/{en,zh,vi,ko,es}/<ns>.json` — all five, real translations (no English placeholders), same key order in every locale.

## 0. shadcn pattern, repo tokens

We adopt the shadcn/ui *pattern* — Radix primitives + `class-variance-authority` variants + `cn()` (clsx + tailwind-merge), components live in the repo and are ours to edit — but NOT the shadcn CSS-variable theme (its `accent`/`border`/`card` token names collide with existing Tailwind tokens). All kit classes use existing repo tokens. No `components.json`, no shadcn CLI, no `tailwindcss-animate`.

Dependencies to add to `client/package.json` (Phase A1 only; run `cd client && npm install <pkgs>` once; commit package-lock):
`@radix-ui/react-context-menu @radix-ui/react-dropdown-menu @radix-ui/react-tabs @radix-ui/react-toggle-group @radix-ui/react-slot class-variance-authority clsx tailwind-merge` (latest; all support React 19).

`client/src/test-setup.ts` gains jsdom polyfills Radix needs (guarded `if (!…)`): `ResizeObserver` (class with observe/unobserve/disconnect no-ops), `Element.prototype.hasPointerCapture/setPointerCapture/releasePointerCapture` (no-ops), `Element.prototype.scrollIntoView` (no-op), `window.matchMedia` (returns `{ matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }`), `DOMRect.fromRect` if missing. Tests open Radix menus with `fireEvent.contextMenu(el)` (context menu) or `await userEvent.click(kebab)` / `fireEvent.pointerDown` + `fireEvent.click` (dropdown) and assert `screen.getByRole("menu")`.

### Layout (atomic → composed)
```
client/src/lib/cn.ts               cn(...inputs) = twMerge(clsx(inputs))
client/src/lib/routes.ts           typed href builders (pure)
client/src/lib/clipboard.ts        copyText(text): Promise<boolean> — navigator.clipboard.writeText, fallback hidden-textarea execCommand("copy") (lift from components/CodexConfigExplorer.tsx:1315-1337 and make that file call it); announces common:eventDetail.copied / common:ui.copyFailed via announceAction
client/src/components/ui/          ATOMS (domain-agnostic, no lib/api, no eventBus imports)
  Button.tsx        Button + buttonVariants (cva)           IconButton.tsx
  Badge.tsx         Badge + badgeVariants (cva)             LivePill.tsx
  Tabs.tsx          Radix Tabs wrappers (Tabs, TabsList, TabsTrigger, TabsContent)
  SegmentedControl.tsx  Radix ToggleGroup (single) — filter/toggle semantics
  Menu.tsx          MenuItem type + <MenuItems items/> renderer (shared by both menus)
  ContextMenu.tsx   Radix ContextMenu wrappers (ContextMenu, ContextMenuTrigger, ContextMenuContent)
  DropdownMenu.tsx  Radix DropdownMenu wrappers + MenuButton (kebab trigger)
  Clickable.tsx     row/card container: mouse conveniences + context menu + kebab
  PageHeader.tsx    SectionHeader.tsx
  index.ts          barrel (values + `export type`)
client/src/components/entity/      MOLECULES (know the domain: types, routes, api)
  EntityRef.tsx     link-by-reference chip with built-in entity context menu
  entityMenu.tsx    entityMenu(ref, ctx): MenuItem[]
  index.ts
```
Existing `components/StatCard.tsx`, `components/EmptyState.tsx`, `components/Tip.tsx`, `components/StatusBadge.tsx`, `components/Select.tsx`, `components/MultiSelect.tsx`, `components/Checkbox.tsx`, `components/ConfirmModal.tsx` remain the kit for those roles — do not duplicate them. `components/event-views/primitives.tsx` `CopyButton` stays; it now calls `lib/clipboard.copyText`.

## 1. `client/src/lib/routes.ts`

```ts
export const routes = {
  sessions: (q?: { status?: string; cwd?: string | string[]; q?: string }) => string,
      // "/sessions?status=…&cwd=a&cwd=b&q=…"  — cwd as REPEATED params (server accepts arrays; paths may contain commas)
  session: (id: string, q?: {
      tab?: "agents" | "conversation" | "timeline";
      agent?: string;        // → "?tab=agents#agent-<id>"  (tab forced; hash emitted by the builder)
      event?: number|string; // → "?tab=timeline&event=<id>"
      transcript?: string;   // → "?tab=conversation&transcript=<transcriptId>"  ("main" for the main agent)
      tool_name?: string;    // → "?tab=timeline&tool_name=<name>"   (same names as routes.activity)
      agent_id?: string;     // → "?tab=timeline&agent_id=<id>"
  }) => string,
  kanban: (q?: { view?: "agents" | "sessions"; project?: string /* raw cwd OK, see §3 */; density?: "cards"|"rows" }) => string,
  activity: (q?: { session?: string; agent?: string; tool?: string; type?: string; status?: string; q?: string; from?: string; to?: string }) => string,
      // params: session_id, agent_id, tool_name, event_type, status, q, from, to — comma-joined lists (ids/names are comma-safe)
  analytics: (q?: { tab?: "cost" | "tokens" | "productivity" | "workflow" }) => string,
  workflows: (q?: { session?: string; run?: string }) => string,
  plan: (slug?: string, q?: { task?: string }) => string,
  run: (q?: { session?: string; prompt?: string; autostart?: boolean; cwd?: string }) => string,
  settings: (section?: "alerts"|"import"|"remote-sources"|"claude-pricing"|"gpt-pricing"|string) => string, // "/settings#<section>"
};
export function absoluteHref(href: string): string; // window.location.origin + href
```
Rules: `encodeURIComponent` every value; omit undefined/empty; query before hash; `autostart:true` → `autostart=1`. Tests: `client/src/lib/__tests__/routes.test.ts`.

History rule (§3 applies it): **controls replace, links push** — every in-page write-back (filters, tab, transcript, task, run, drill-in session, cwd, density) uses `setSearchParams(fn, { replace: true })`; EntityRef/Clickable/menu `to` navigations push.

## 2. Atoms — `client/src/components/ui/`

Common: named exports; `className` merged with `cn()`; `LucideIcon` for icons; forwardRef where Radix `asChild` needs it (Button, IconButton). Sizes pinned: IconButton `xs = w-6 h-6` (24px WCAG floor, icon w-3.5), `sm = w-7 h-7` (icon w-4), `md = w-8 h-8` (icon w-4). Never smaller than 24px.

- **Button** `{ variant?: "primary"|"secondary"|"ghost"|"danger"; size?: "xs"|"sm"|"md"; icon?: LucideIcon; loading?: boolean; asChild?: boolean; to?: string } & ButtonHTMLAttributes<HTMLButtonElement>`.
  primary = `.btn-primary` look (bg-accent hover:bg-accent-hover text-white font-medium; contrast 4.47:1 — never `size="xs"` with primary); secondary = `border border-border bg-surface-2 text-gray-200 hover:bg-surface-4`; ghost = `.btn-ghost` look; danger = `bg-red-500/10 border border-red-500/25 text-red-300 hover:bg-red-500/20`. `to` renders react-router `<Link>` via `Slot`/asChild with identical classes. `loading` shows `Loader2 animate-spin motion-reduce:animate-none` and sets `aria-busy` + disabled. Export `buttonVariants`.
- **IconButton** `{ icon: LucideIcon; label: string /* REQUIRED → aria-label + title */; size?: "xs"|"sm"|"md"; variant?: "ghost"|"secondary"|"danger" } & ButtonHTMLAttributes`.
- **Badge** `{ tone?: "neutral"|"accent"|"success"|"warning"|"danger"|"info"|"violet"; size?: "xs"|"sm"; dot?: boolean; pulse?: boolean; icon?: LucideIcon; mono?: boolean } & HTMLAttributes<HTMLSpanElement>`. Exact tone classes: neutral `text-gray-300 bg-surface-4 border-border`; accent `text-indigo-300 bg-indigo-500/10 border-indigo-500/25`; success `text-emerald-300 bg-emerald-500/10 border-emerald-500/25`; warning `text-amber-300 bg-amber-500/10 border-amber-500/25`; danger `text-red-300 bg-red-500/10 border-red-500/25`; info `text-sky-300 bg-sky-500/10 border-sky-500/25`; violet `text-violet-300 bg-violet-500/10 border-violet-500/25`. `xs` = `text-[10px] px-1.5 py-0.5 rounded-full border inline-flex items-center gap-1`; `sm` = `.badge` metrics. `dot` renders `w-1.5 h-1.5 rounded-full bg-current`; `pulse` adds `animate-pulse motion-reduce:animate-none` to the dot. Export `badgeVariants`.
- **LivePill** `{ connected: boolean }` → `<span role="status">` wrapping `<Badge tone="success" dot pulse>{t("common:live")}</Badge>` / `<Badge tone="neutral" dot>{t("common:offline")}</Badge>`. Prop-driven only.
- **Tabs** — thin Radix wrappers: `Tabs` (Root), `TabsList` (segmented style: `inline-flex bg-surface-2 rounded-lg p-0.5 border border-border`; `variant="underline"` = `flex items-center gap-1 border-b border-border`), `TabsTrigger` (`{ value; icon?: LucideIcon; count?: number }`; selected = `bg-surface-4 text-gray-100` for segmented / `border-b-2 border-accent text-gray-100` for underline; unselected `text-gray-400 hover:text-gray-200`), `TabsContent` (forwards; `className="outline-none"`). Automatic activation (Radix default), arrow keys, roving focus — free. **Callers must render `<TabsContent value>` for each tab** (Radix links `aria-controls`). Use with `useUrlTab`: `<Tabs value={tab} onValueChange={(v) => setTab(v as T)}>`.
- **SegmentedControl** `{ value: T; onValueChange(v: T); items: { value: T; label: string; icon?: LucideIcon; count?: number }[]; ariaLabel: string; size?: "sm"|"md" }` → Radix `ToggleGroup type="single"` (role=radiogroup/radio, aria-checked, never allows empty — re-selecting the current value is a no-op). Same segmented look as TabsList. For filter pills (Sessions status), density toggles, provider toggles.
- **Menu.tsx** — shared vocabulary:
  ```ts
  export type MenuItem =
    | { label: string; icon?: LucideIcon; onSelect?: () => void | Promise<void>; to?: string; danger?: boolean; disabled?: boolean }
    | { type: "separator" }
    | { type: "label"; label: string };  // used for the full id/path line at the top of entity menus
  export function MenuItems({ items, Item, Separator, Label }): ReactNode   // renders with the given Radix parts (ContextMenu.* or DropdownMenu.*)
  ```
  `to` items render `<Item asChild><Link to={to} …>` so ctrl/meta/middle-click open a new tab natively; `danger` = `text-red-300 focus:bg-red-500/10`. Item classes: `flex items-center gap-2 px-2.5 py-1.5 text-sm text-gray-200 rounded-md cursor-default select-none outline-none data-[highlighted]:bg-surface-4 data-[disabled]:opacity-50`.
- **ContextMenu.tsx** — `ContextMenu` (Root), `ContextMenuTrigger` (asChild), `ContextMenuContent` (Portal + Content styled `min-w-[12rem] bg-surface-3 border border-border rounded-lg p-1 shadow-xl z-[80] text-sm`, `onEscapeKeyDown={(e) => e.stopPropagation()}` so Escape never also closes an enclosing modal's window listener), plus re-exports `ContextMenuItem/Separator/Label`. Convenience: `<ContextMenuFor items={MenuItem[]} disabled?>{child}</ContextMenuFor>` = Root + Trigger asChild + Content(MenuItems). Radix gives right-click, touch long-press (700ms), collision clamping, focus return, typeahead.
- **DropdownMenu.tsx** — same shape for Radix DropdownMenu + **MenuButton** `{ items: MenuItem[]; label: string; size?: "xs"|"sm"; className? }` = `DropdownMenu` + `DropdownMenuTrigger asChild` `<IconButton icon={MoreHorizontal} label={label} …/>` (Radix sets aria-haspopup/aria-expanded) + Content(MenuItems, align="end").
- **Clickable** — the row/card container. `{ as?: "div"|"tr"|"li"; to?: string; onActivate?: () => void; menu?: MenuItem[]; menuLabel?: string /* default t("common:ui.openMenu") */; kebab?: boolean /* default true when menu */; children; className } & Omit<HTMLAttributes<HTMLElement>, "onClick">` (spreads rest → id, aria-*, data-*).
  Rules (from the a11y critique): NO role, NO tabIndex on the container. Exactly one primary control lives inside (an EntityRef/`<Link>` for `to`, or a `<button aria-expanded>` for `onActivate`) — that is the keyboard target. Container `onClick`: ignore when `(e.target as Element).closest("a,button,input,select,textarea,[role=button],[role=menuitem]")` (so inner controls need no stopPropagation); ctrl/meta/middle click with `to` → `window.open(to, "_blank", "noopener")`; plain click → `navigate(to)` or `onActivate()`. Wrapped in `ContextMenuFor` when `menu` given (right-click / long-press); `data-menu=""` attribute on the container for tests. Contextmenu passes through natively (`disabled`) when `e.shiftKey` or `window.getSelection()?.toString()` is non-empty. When `menu` and `kebab`, renders `<MenuButton size="xs">` as the LAST child with classes `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 data-[state=open]:opacity-100`; the container gets `group` and `cursor-pointer` (when to/onActivate). Kebab is always in the tab order. `as="tr"` → kebab goes in the last `<td>`; caller passes `kebab={false}` and renders `<td><MenuButton items={menu} …/></td>` itself.
- **PageHeader** `{ icon: LucideIcon; title: string; subtitle?: ReactNode; live?: boolean; back?: string | (() => void); actions?: ReactNode; children?: ReactNode /* second row: tabs/filters */ }`. Exact classes copied from `pages/Dashboard.tsx:1198-1218`: wrapper `flex flex-wrap items-center justify-between gap-3`; left `flex items-center gap-3 min-w-0`; tile `w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center flex-shrink-0` + icon `w-4.5 h-4.5 text-accent` (use `w-[18px] h-[18px]` if 4.5 not configured); h1 `text-lg font-semibold text-gray-100`; subtitle `text-xs text-gray-400`; `live` → `<LivePill>` next to the title; no outer margin (pages space with their own column gap). `back` string → `<IconButton icon={ArrowLeft} label={t("common:ui.back")}>` as Link; function → button.
- **SectionHeader** `{ icon?: LucideIcon; title: string; count?: number|string; aside?: ReactNode; actions?: ReactNode; size?: "xs"|"sm" }` → xs `text-xs font-semibold uppercase tracking-wider text-gray-400`; sm `text-sm font-medium text-gray-300`; layout `flex items-center justify-between gap-3`.

## 3. Molecules — `client/src/components/entity/`

**EntityRef** — the one "link by reference" chip.
```ts
export type EntityRefProps = (
  | { kind: "session"; id: string; name?: string | null; cwd?: string | null; source?: string | null; transient?: boolean }
  | { kind: "agent"; id: string; sessionId: string; type: string | null | undefined /* required: "main" ⇒ transcript "main" */; name?: string | null }
  | { kind: "project"; cwd: string; source?: string | null }
  | { kind: "tool"; name: string; sessionId?: string }
  | { kind: "eventType"; type: string }
  | { kind: "model"; model: string }
  | { kind: "event"; id: number | string; sessionId: string; toolName?: string | null; agentId?: string | null }
) & { chars?: number /* id-fallback truncation, default 8; 0 = full */; mono?: boolean; className?: string; children?: ReactNode /* custom label */; menu?: boolean /* default true */ }
```
Renders `<Link to={primaryHref} title={fullValue} className={cn("font-mono text-[11px] text-gray-300 hover:text-gray-100 hover:underline decoration-dotted underline-offset-2 truncate max-w-full", className)}>` wrapped in `ContextMenuFor items={entityMenu(...)}`; `onContextMenu` on the link calls `e.stopPropagation()` before Radix handles it (so an enclosing Clickable's menu does not also open) — implement as `onContextMenuCapture`/wrapper `onContextMenu={(e) => e.stopPropagation()}` on the Trigger element. `session` with `transient` (pre-identity Codex process) renders a plain `<span className="font-mono" title>` with no link and no menu.
Default labels: session → `name ?? \`${t("sessions:defaultName")} ${id.slice(0, chars)}\`` — check the exact existing key used by SessionCard/SessionDetail for the fallback name and reuse it; agent → `name ?? type ?? id.slice(0,chars)`; project → `projectLabel(projectRootOf(cwd))` + (sub-path if any) using helpers from `components/ProjectBadge.tsx`; tool → name; eventType → type; model → raw `model` (callers pass `children={formatModelName(model)}` for the short form); event → `#${id}`. `title` always = full raw value (id / cwd / model).
Primary hrefs: session→`routes.session(id)`; agent→`routes.session(sessionId,{agent:id})`; project→`routes.sessions({cwd})`; tool→`routes.activity({tool:name, session:sessionId})`; eventType→`routes.activity({type})`; model→`routes.analytics({tab:"cost"})`; event→`routes.session(sessionId,{event:id})`.

**entityMenu(ref, ctx)** — `ctx = { t, copy: (text) => Promise<boolean>, openCwd?: (cwd) => Promise<void> }`. First item is always `{ type:"label", label: fullValue }`. Labels = `t("common:ui.menu.<key>")`:
- session: open · openConversation (`transcript:"main"`) · openTimeline · — · showInActivity (`routes.activity({session:id})`) · sessionsInProject (if cwd) · showOnBoard (if cwd → `routes.kanban({project:cwd})`) · resumeInRun (`routes.run({session:id})`) · — · copySessionId · copyPath (if cwd) · copyLink · revealFolder (if cwd && (!source || source==="local") → `api.sessions.openCwd(cwd)`, announce `kanban:project.opened`/`kanban:project.openFailed` exactly as ProjectBadge does).
- agent: openConversation (`transcript: type==="main" ? "main" : id`) · openEvents (`routes.session(sessionId,{agent_id:id})`) · openSession · showInActivity (`routes.activity({agent:id})`) · — · copyAgentId · copySessionId · copyLink.
- project: sessionsInProject · showOnBoard · — · copyPath · revealFolder (local only).
- tool: showInActivity · filterByTool (if sessionId → `routes.session(sessionId,{tool_name:name})`) · — · copyToolName.
- eventType: showInActivity · — · copyEventType.
- model: costAnalytics · pricingRules (`routes.settings("claude-pricing")`) · — · copyModelId.
- event: openTimeline (`routes.session(sessionId,{event:id})`) · showInActivity (`routes.activity({session:sessionId})`) · filterByTool (if toolName → `routes.session(sessionId,{tool_name})`) · openAgent (if agentId → `routes.session(sessionId,{agent:agentId})`) · — · copyEventId · copyLink.
"Copy link" = `copy(absoluteHref(primaryHref))`. `api.sessions.openCwd` is dereferenced lazily inside onSelect (tests mock `../../lib/api` without it). `components/entity/*` may import `lib/api`, `lib/routes`, `lib/clipboard`, `lib/format`, `components/ProjectBadge` helpers, `components/ui`.

## 4. Navigation targets (pages READ these)

- **ActivityFeed**: URL is the single source of truth: `const [sp, setSp] = useSearchParams(); const filters = useMemo(() => parseFilters(sp), [sp]); const setFilters = useCallback((v) => setSp(serializeFilters(v), { replace: true }), [setSp]);` — remove the `useState<EventFiltersValue>`; `activity.clearFilters` palette action calls `setFilters(EMPTY_FILTERS)`. Params: session_id, agent_id, tool_name, event_type, status (comma lists), q, from, to. `EventFilters.tsx` is NOT modified.
- **Sessions**: `cwd` from `sp.getAll("cwd")` and written back on MultiSelect change (replace); `status` stays on useUrlTab; `q` seeds `searchInput` (Sessions.tsx:128-130).
- **SessionDetail**:
  - `?tab=agents#agent-<id>`: capture `location.hash` per `location.key` in a ref; in an effect on `[agents, target]`: add the target and every ancestor (walk `parent_agent_id`) to `expandedAgents`; next frame `document.getElementById("agent-"+id)?.scrollIntoView({block:"center"})` + ring class (`ring-2 ring-accent/60`) for 1.5s; run once per hash value. Each AgentCard wrapper on this page gets `id={"agent-"+agent.id}`.
  - `?event=<id>`: after the initial `loadEvents` resolves, if the event is not in `events` and `events.length < eventsTotal`, call `loadMoreEvents()` once (500) and retry; if found → `setExpandedEvents(prev ∪ {id})`, scroll `#event-<id>` into view, ring; if still absent → `announceAction(t("sessions:detail.eventNotLoaded"))` (new key ×5). Trigger once per `event` value. Does NOT clear filters. Timeline rows get `id={"event-"+event.id}`.
  - `?transcript=<id>`: tab=conversation; pass as `initialTranscriptId`; `ConversationView` gains `onTranscriptChange?: (id: string | null) => void` (called from its `<select>` and the initial sync) — ConversationView must NOT import router hooks (its test renders without a Router); SessionDetail writes the URL (replace).
  - `?tool_name=` / `?agent_id=`: seed timeline `filters.tool_name` / `filters.agent_id` (replace semantics; the seed is read once per `location.key`).
- **Kanban**: `?project=` accepts a raw cwd: `const activeProject = projectCounts.has(project) ? project : (rootByCwd.get(project) ?? "")` at KanbanBoard.tsx:271. `?density=cards|rows` via `useUrlTab(["cards","rows"],"cards",{param:"density",storageKey:"kanban-density"})`.
- **Workflows**: `?session=<id>` opens the drill-in (write back, replace) and `scrollIntoView` the drill-in section; `?run=<id>` → `WorkflowRunsPanel` gains additive props `expandedRunId?: string | null; onExpandedRunChange?: (id: string | null) => void` (ignore unknown ids). SessionDetail keeps calling it unchanged.
- **Plan**: `?task=<key>` opens the task drawer; write back (replace). Server `server/plan/join.js:243` adds `sessionId: r.session_id` next to the existing 8-char `session` field; `client/src/plan/types.ts` `PlanAgent` gains `sessionId: string`; Plan uses `agent.sessionId` for EntityRef(agent) and the open-session link (react-router `<Link>` instead of `<a href>`). Additive API change — note it for docs.
- **Run**: `?session=` for a non-live session falls back to resume mode instead of erroring: in the `.then` at Run.tsx:1107-1123 when no live handle → `api.sessions.get(sid).then(({ session }) => { setProvider(session.provider ?? "claude"); setMode("conversation"); setResumeSession(session); })` (verify these setters exist; keep the finally-strip of the param). `?cwd=` → `useState(() => searchParams.get("cwd") ?? "")` at Run.tsx:698.
- **paletteCommands**: add `{ to: "/plan", icon: <same icon Sidebar uses>, navKey: "nav:plan" }` after /workflows; `lib/__tests__/paletteCommands.test.ts` maps `path.replace(/\/:[^/]+\?$/, "")` before its `':'` filter; `components/__tests__/CommandPalette.test.tsx:136` expects 10 (comment "ten sidebar routes").

## 5. Phase B adoption — disjoint ownership (each group owns exactly these files + listed tests)

Common to every group: hand-rolled page header → `<PageHeader>`; icon-only buttons → `<IconButton>` (translated `label`); `.btn-*`/inline button clusters in files you own → `<Button>`; inline pills → `<Badge>`; every rendered session id / agent / cwd / tool / model / event id becomes `<EntityRef>`; list rows/cards → `<Clickable>` with `entityMenu` items (+ kebab); tab controls → `<Tabs>` (with `TabsContent`) or `<SegmentedControl>` for filters. Fix hardcoded-English aria-labels in files you own by adding keys to your namespaces. Nobody edits `pages/__tests__/screens.snapshot.test.tsx` or `__snapshots__/`; run `cd client && npx tsc -b && npx vitest run --exclude "**/screens.snapshot.test.tsx"` as your gate, plus `npx prettier --write` on files you own.

**Group A (Dashboard + Kanban + cards)** — owns `pages/Dashboard.tsx, pages/KanbanBoard.tsx, components/SessionCard.tsx, components/AgentCard.tsx, components/ProjectBadge.tsx, components/TodoProgressIndicator.tsx, components/TodoProgressPanel.tsx`, tests `components/__tests__/AgentCard.test.tsx, SessionCard.test.tsx, ProjectBadge.test.tsx, pages/__tests__/Dashboard.recentActivity.test.tsx`, i18n `*/kanban.json, */dashboard.json`. Do NOT touch StatusBadge.tsx, lib/format.ts, api.ts, types.ts.
  - AgentCard + SessionCard: `variant?: "card"|"row"`. Row = one line: `<AgentStatusBadge compact>`/`<SessionStatusBadge compact>` (the waiting reason must be reachable without a mouse: put it in `title` + `aria-label` on the focusable EntityRef, or visually-hidden text) · name as EntityRef · subtitle (agent: type/model; session: `name ? basename(cwd) : promptPreviewLines(prompt)[0]`) · `current_tool` chip (agents; truncated, title=full) · TodoProgressIndicator if present · `<time title={full}>{timeAgo}</time>`. Omit ProjectBadge, task lines, cost/model footer. Card variant = today's layout, but: wrapper becomes `<Clickable to={…} menu={entityMenu(session|agent)}>`, header name → EntityRef, footer session id → EntityRef(session), current tool → EntityRef(tool, sessionId), model → EntityRef(model, children=formatModelName). Transient sessions: plain span, no `to`.
  - Switch the three duplicated helpers to `lib/format.ts` exports (`promptPreviewLines`, `isTransientProcess`, `formatCostShort` — Phase A adds them; delete the local copies).
  - ProjectBadge: label+sub-path → single `<EntityRef kind="project">` carrying the `title={cwd}` (remove it from the outer span); FolderOpen button stays the only `<button>`; no kebab. Wrap the two ProjectBadge.test renders in `<MemoryRouter>`.
  - Dashboard: header → PageHeader(live); monitor/health tabs → Tabs+TabsContent; active-agents tree uses `variant="row"` (fix the AGENT_ROW_H constant accordingly); recent-activity rows → Clickable(to=session at event, menu=event) with EntityRef(session) label and EntityRef(tool) chip (keep `div.px-4` wrapper the test finds, or update that test); health tab: tool-usage bar labels → EntityRef(tool), token-usage model → EntityRef(model), integration cwd → EntityRef(project); section headers → SectionHeader; translate the ~40 hardcoded strings in SystemHealthTab (dashboard.json ×5).
  - Kanban: header → PageHeader; ViewToggle → SegmentedControl; ProjectTabs stay (already tablist-ish) but use Badge for counts; density toggle (§4) rendering `variant="rows"` cards; column count pill → link `routes.sessions({status, cwd: root})`; `?project` raw-cwd fallback (§4).
  - Dedupe the duplicated agent-tree renderer only if cheap; otherwise leave.

**Group B (Sessions + SessionDetail)** — owns `pages/Sessions.tsx, pages/SessionDetail.tsx, components/SessionOverview.tsx, components/conversation/ConversationView.tsx (only the `onTranscriptChange` prop)`, tests `pages/__tests__/SessionDetail.hookOnly.test.tsx, SessionDetail.nestedAgents.test.tsx, components/conversation/__tests__/ConversationView.pagination.test.tsx`, i18n `*/sessions.json`.
  - Sessions: header → PageHeader(live); status pills → SegmentedControl; table rows → `<Clickable as="tr" to={routes.session(id)} menu={entityMenu(session)} kebab={false}>` + a last `<td>` with `<MenuButton>`; name cell → EntityRef(session) (primary control); cwd cell → EntityRef(project); agent count → `<Link to={routes.session(id,{tab:"agents"})}>`; model → EntityRef(model); source pill → Badge(info); pager buttons → Button secondary; `cwd`/`q` URL write-back (§4). Transient rows: no `to`, plain id.
  - SessionDetail: header → PageHeader(back=goBack, actions) with EntityRef chips (id chars=16 as today, model, project) and CopyButtons; tabs → Tabs+TabsContent (agents/conversation/timeline); all §4 targets (`#agent-`, `?event=`, `?transcript=`, `?tool_name=`, `?agent_id=`); timeline rows → Clickable(onActivate=expand, menu=entityMenu(event)) with the existing expander `<button aria-expanded>` as primary control, `id="event-<id>"`, tool chip → EntityRef(tool, sessionId), origin label → EntityRef(agent); agents tab AgentCards get `id="agent-<id>"` wrappers; cost table model → EntityRef(model); `Session ${id}` fallback → the i18n key. Fix icon-only back/refresh/dismiss buttons via IconButton.
  - SessionOverview: top tools → EntityRef(tool, sessionId); event mix chips → `<Link to={routes.session(id,{tab:"timeline"})}>`-style filters are out of scope unless a 1-line `?event_type` seed exists — otherwise leave; translate the ~25 hardcoded strings (sessions.json ×5); section headers → SectionHeader.

**Group C (Feed + Analytics + Workflows + Plan)** — owns `pages/ActivityFeed.tsx, components/EventDetail.tsx, pages/Analytics.tsx, pages/Workflows.tsx, components/workflows/*.tsx, plan/Plan.tsx, plan/types.ts, server/plan/join.js`, tests `components/__tests__/EventDetail.test.tsx, components/workflows/__tests__/*.test.tsx (if any), plan/__tests__/*.test.tsx (if any), pages/__tests__/Workflows.codex.test.tsx, server/__tests__/plan-join.test.js (only if it needs the new field)`, i18n `*/activity.json, */analytics.json, */workflows.json, */plan.json`.
  - ActivityFeed: URL-backed filters (§4); header → PageHeader(live); rows → Clickable(to=routes.session(sid,{event:id}), menu=entityMenu(event)); project/session/agent labels → EntityRef; tool pill → EntityRef(tool); "View session" → open at event. EventDetail: session_id/agent_id/cwd/model/tool_name rows → EntityRef with `chars={0}`; wrap EventDetail.test renders in MemoryRouter.
  - Analytics: header → PageHeader; tab strip → Tabs+TabsContent; tool-usage / event-type bar labels → EntityRef(tool | eventType); cost-by-model rows → EntityRef(model, children=formatModelName); subagent-type labels stay text.
  - Workflows: `?session`/`?run` (§4); header → PageHeader; SessionDrillIn header → EntityRef(session) + agent tree rows → EntityRef(agent, type) + tool pills → EntityRef(tool, sessionId); WorkflowRunsPanel: run session link → EntityRef(session), agent rows → EntityRef(agent), model → EntityRef(model); scatter bubble: add a right-click menu via `useState<{x,y}>` + `ContextMenuFor`-equivalent (Radix ContextMenu needs a trigger element — wrap the SVG container and derive the hovered session; if not cheap, just make the tooltip name an EntityRef).
  - Plan: `sessionId` plumbing (§4), agent rows/task-card badges → EntityRef(agent), `?task=`, `<a href>` → `<Link>`, cwd hint → EntityRef(project).

**Group D (Shell + big pages, light touch)** — owns `components/Sidebar.tsx (only the ConnectionStatusModal event-type rows), lib/paletteCommands.ts, pages/Run.tsx, pages/CcConfig.tsx, pages/Settings.tsx, components/CodexConfigExplorer.tsx (only the copyText lift is already done by Phase A — do not re-edit unless needed), components/AlertsNotifications.tsx, components/ImportHistory.tsx, components/Tabby/TabbyPanel.tsx`, tests `lib/__tests__/paletteCommands.test.ts, components/__tests__/CommandPalette.test.tsx, components/__tests__/Sidebar.test.tsx, pages/__tests__/Run.defaultCwd.test.tsx`, i18n `*/run.json, */ccConfig.json, */settings.json, */nav.json, */alerts.json`.
  - Only: PageHeader on Run/CcConfig/Settings; EntityRef for session id (live toolbar + history rows) / cwd / model in Run; Run `?session` fallback + `?cwd` (§4); CcConfig memory-project rows → EntityRef(project), agent/skill model chips → EntityRef(model), hooks event-group headers → EntityRef(eventType); Settings pricing model patterns → EntityRef(model) only when the pattern is a literal model id (no wildcards); AlertsNotifications activity rows → EntityRef(session) + EntityRef(agent) + Clickable menu; ImportHistory result path → EntityRef(project); Sidebar ConnectionStatusModal TypeBar/recent rows → EntityRef(eventType); Tabby "Errored" → `routes.sessions({status:"error"})`; palette `/plan` (§4); translate hardcoded scroll/dismiss aria-labels. No wholesale refactors of these files.

## 6. i18n — Phase A2 writes `common.json` ×5

```json
"ui": {
  "back": "Back",
  "openMenu": "More actions",
  "copyFailed": "Copy failed",
  "density": { "cards": "Cards", "rows": "Rows" },
  "menu": {
    "open": "Open", "openConversation": "Open conversation", "openTimeline": "Open timeline", "openSession": "Open session", "openAgent": "Open agent", "openEvents": "Open events",
    "showInActivity": "Show in Activity", "sessionsInProject": "Sessions in this project", "showOnBoard": "Show on Board", "resumeInRun": "Resume in Run", "filterByTool": "Filter by this tool",
    "costAnalytics": "Cost analytics", "pricingRules": "Pricing rules",
    "copySessionId": "Copy session ID", "copyAgentId": "Copy agent ID", "copyEventId": "Copy event ID", "copyModelId": "Copy model ID", "copyToolName": "Copy tool name", "copyEventType": "Copy event type", "copyPath": "Copy path", "copyLink": "Copy link",
    "revealFolder": "Reveal folder"
  }
}
```
Existing keys reused: `common:live`, `common:offline`, `common:actions`, `common:eventDetail.copy`, `common:eventDetail.copied`, `kanban:project.opened`, `kanban:project.openFailed`. Group B adds `sessions:detail.eventNotLoaded`.

## 7. Phase A tests
`lib/__tests__/routes.test.ts`; `components/ui/__tests__/Button.test.tsx` (variants, `to` → Link, IconButton aria-label/title); `components/ui/__tests__/Tabs.test.tsx` (tablist roles, arrow keys change value, SegmentedControl radiogroup); `components/ui/__tests__/ContextMenu.test.tsx` (contextmenu opens role=menu, items render, `to` item is a link, Escape closes, MenuButton opens dropdown); `components/ui/__tests__/Clickable.test.tsx` (click navigates, click on inner button does not, ctrl-click opens window, kebab present, `data-menu`); `components/entity/__tests__/EntityRef.test.tsx` (href per kind, transient session is a span, menu items per kind, copy calls clipboard stub, `chars={0}`); `lib/__tests__/clipboard.test.ts` (clipboard path + execCommand fallback). Wrap in `MemoryRouter`; stub `navigator.clipboard`.

## 8. Gates (orchestrator runs the full set; agents run their narrow ones)
`cd client && npx tsc -b && npx vitest run` · `npm run format:check` (repo root) · `bash .claude/skills/file-headers/scripts/check-headers.sh` · `bash .claude/skills/i18n-parity/scripts/i18n-audit.sh` · `npm run test:server` (Plan join change). Snapshot baselines regenerate only after review (`cd client && npx vitest run -u`). Three snapshot tests (Analytics, Workflows, Claude Config) already fail at baseline on this Windows machine because of 24h time formatting — ignore exactly those three.
