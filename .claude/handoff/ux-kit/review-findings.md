# Phase C review findings (fix backlog)

Severity-ordered per lens. `ours=false` = pre-existing user code, do not touch unless trivial.

Totals: high=4 medium=15 low=34


## Lens: over-engineering + atomicity (lazy senior dev)

The kit itself is lean; the debt is in adoption. The same 4 blocks were copy-pasted instead of absorbed (waiting-reason sr-only text ×4, kebab-reveal class ×6, SectionHeader/PageHeader margin wrappers ×13, agent-tree renderer ×2, event row ×2, card row variant ×2), two i18n keys are now dead in 5 locales, two more are duplicated across namespaces, ProjectBadge and entityMenu carry the same label/sub split and reveal-folder logic (with a circular import), and ~10 kit props / 4 route/type exports have zero callers. CopyButton was supposed to route through lib/clipboard and still does not. No unused imports (tsc noUnusedLocals is clean). Pre-existing server/ProjectBadge user work has nothing to cut under this lens.

### [MEDIUM] client/src/components/StatusBadge.tsx:137 (ours)
- Problem: The waiting-reason text StatusBadge already computes for its tooltip (AWAITING_REASON_CONFIG[reason].descKey + provider) is recomputed and rendered as an sr-only span in four call sites: AgentCard.tsx:222-226/274/348 and SessionCard.tsx:130-133/184/245, each importing AWAITING_REASON_CONFIG.
- Scenario: Sessions table (or any future compact-badge consumer) is switched to compact mode; nobody copies the sr-only block, and keyboard/screen-reader users lose the reason again. The 'Codex'/'Claude' provider-label rule now lives in three files to drift.
- Fix: In AgentStatusBadge/SessionStatusBadge: `{compact && shownReason && <span className="sr-only">{reasonText}</span>}` inside the badge (reasonText is the existing Tip raw string). Delete the four reasonText/sr-only copies and the AWAITING_REASON_CONFIG imports from AgentCard/SessionCard.

### [MEDIUM] client/src/components/ui/Clickable.tsx:90 (ours)
- Problem: The kebab hover-reveal class string (`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 data-[state=open]:opacity-100`) is pasted six times: Clickable.tsx:90, AgentCard.tsx:303 and 353, SessionCard.tsx:208 and 250, Sessions.tsx:118 (ROW_KEBAB_CLASS).
- Scenario: The coarse-pointer rule is adjusted in Clickable (e.g. to also show on `hover: none`); Kanban cards and the Sessions table keep hiding the kebab on tablets.
- Fix: Add `reveal?: boolean` to MenuButton (DropdownMenu.tsx) that appends the class via cn(); Clickable passes `reveal`; the five callers become `<MenuButton size="xs" items={menu} reveal />` and ROW_KEBAB_CLASS is deleted.

### [MEDIUM] client/src/components/SessionCard.tsx:237 (ours)
- Problem: Card variant renders EntityRef(session) twice — the title (line 234) and the 12-char id line (line 237) — both linking to routes.session(id) with identical context menus, inside a Clickable that already navigates there and already carries the same menu.
- Scenario: Tab through a Kanban sessions column: each card costs two identical tab stops before the kebab, project chip, folder button and model chip (six per card). Right-clicking the id opens the same menu as right-clicking the title or the card surface.
- Fix: Make the id line plain: `<span className="font-mono" title={session.id}>{session.id.slice(0, 12)}</span>`; drop the `className` parameter from the `sessionRef` closure (single caller left).

### [MEDIUM] client/src/components/entity/entityMenu.tsx:118 (ours)
- Problem: `reveal` (entityMenu.tsx:118-133) duplicates ProjectBadge.open (ProjectBadge.tsx:120-130) line for line, and `projectParts` (entityMenu.tsx:95-100) duplicates ProjectBadge's label/sub split (ProjectBadge.tsx:113-116); the two files now import each other (ProjectBadge → ./entity → entityMenu → ../ProjectBadge).
- Scenario: The openFailed message mapping or the success toast changes in ProjectBadge; the menu's 'Reveal folder' keeps the old copy. Any future module-scope use of a ProjectBadge helper inside entityMenu evaluates to undefined because of the cycle.
- Fix: Move normalizeCwd/projectRootOf/projectRoots/projectLabel/projectColor/projectParts(cwd, root?) and a `revealCwd(cwd, t)` (api.sessions.openCwd + the two announceAction calls) into `lib/project.ts`; ProjectBadge and entityMenu both import from there; ProjectBadge's open() becomes `e.stopPropagation(); void revealCwd(cwd, t)` and its label/sub come from projectParts(cwd, root).

### [MEDIUM] client/src/i18n/locales/en/alerts.json:74 (ours)
- Problem: `alerts:feed.viewSession` (alerts.json:74, all five locales) and `workflows:runs.openSession` (workflows.json:20, all five locales) have no callers: AlertsNotifications.tsx and WorkflowRunsPanel.tsx replaced the Link/title that used them with EntityRef.
- Scenario: The i18n audit only checks parity, so ten dead strings ship and get translated on every future locale pass.
- Fix: Delete `feed.viewSession` from en/es/ko/vi/zh alerts.json and `runs.openSession` from en/es/ko/vi/zh workflows.json.

### [LOW] client/src/i18n/locales/en/dashboard.json:23 (ours)
- Problem: `expandSubagents`/`collapseSubagents` were added with identical English to both dashboard.json:23-24 and sessions.json:77-78 (×5 locales = 20 entries for two strings) because the agent-tree chevron is copy-pasted in Dashboard.tsx:1427 and SessionDetail.tsx:1096.
- Scenario: A translator fixes the Korean wording in one namespace; the other tree keeps the old label.
- Fix: One pair under common.json (`subagents.expand` / `subagents.collapse`), both trees read `t("common:subagents.expand")`; delete the duplicates (falls out naturally from the AgentTree extraction).

### [LOW] client/src/components/ui/Badge.tsx:43 (ours)
- Problem: Kit props with zero callers outside the kit's own tests: Badge.mono (Badge.tsx:43), Button.asChild (Button.tsx:45 — only `to` is ever used), EntityRef.menu (EntityRef.tsx:30), SectionHeader.aside (SectionHeader.tsx:17), Clickable.menuLabel (Clickable.tsx:30), PageHeader.back string branch (PageHeader.tsx:42-43; only the function form is used), SegmentedItem.icon/count (SegmentedControl.tsx:18-19), TabsTrigger.count (Tabs.tsx:48 — SessionDetail.tsx:973 hand-rolls `({agents.length})` instead of using it).
- Scenario: `<Button asChild>` without `to` renders the leading icon outside the Slottable child — a code path no page exercises, kept alive only by the kit's own test; each unused prop is a branch to keep in sync with no consumer to catch drift.
- Fix: Delete the unused props/branches (add back with the first real caller). For TabsTrigger.count either use it at SessionDetail.tsx:973 (`count={agents.length}`) or delete it.

### [LOW] client/src/lib/routes.ts:91 (ours)
- Problem: `routes.workflows` (routes.ts:91), `routes.plan` (routes.ts:94), the exported `SessionTab`/`AnalyticsTab` types (routes.ts:26-27) and the barrel re-exports `buttonVariants`/`badgeVariants` (ui/index.ts:9,13) have no importers; Plan.tsx:166 and :279 still build `/plan/${slug}` by hand.
- Scenario: Workflows.tsx reads `session`/`run` params directly; `routes.workflows` can drift to different names and nothing fails because nobody calls it.
- Fix: Plan.tsx uses `routes.plan(slug)` at 166/279; delete `routes.workflows`, the two type exports and the `*Variants` re-exports (keep cva internal to Button/Badge).

### [LOW] client/src/components/event-views/primitives.tsx:121 (ours)
- Problem: CopyButton still calls `navigator.clipboard.writeText` and swallows failure, while `lib/clipboard.copyText` (execCommand fallback + toast) now sits beside it in the SessionDetail header (SessionDetail.tsx:825 and :855) and in every entity menu. The spec's 'CopyButton now calls copyText' was not done.
- Scenario: Dashboard opened over plain HTTP from another machine: the chip menu's 'Copy session ID' works via the fallback and toasts; the CopyButton next to it silently does nothing.
- Fix: `async function copy() { if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }` and drop the try/catch.

### [LOW] client/src/pages/ActivityFeed.tsx:271 (ours)
- Problem: The English literal fallback `Session ${s.id.slice(0, 8)}` now flows into `name=` of the row's EntityRef(session) (ActivityFeed.tsx:521), overriding EntityRef's localized `sessions:defaultName` default label.
- Scenario: Korean UI: an unnamed session's feed row reads 'Session 1a2b3c4d' while the same session on SessionDetail reads '세션 1a2b3c4d'.
- Fix: `const label = s.name?.trim() || \`${t("sessions:defaultName")}${s.id.slice(0, 8)}\``, as SessionDetail.tsx:525 already does.

### [LOW] client/src/components/EventDetail.tsx:335 (ours)
- Problem: `chars={0}` is passed together with explicit `children` at EventDetail.tsx:335 and :346 (and `chars={16}` + `name=` + children at SessionDetail.tsx:814); `chars`/`name` only shape the default label, which `children` replaces, so they are dead props.
- Scenario: Someone changes `chars` expecting the rendered id to shorten; nothing changes.
- Fix: Drop `chars`/`name` where `children` is given (or drop `children` and rely on the default label where it already matches).

### [LOW] client/src/pages/ActivityFeed.tsx:457 (ours)
- Problem: The agent-type fallback `info?.type ?? (id.endsWith("-main") ? "main" : "subagent")` is duplicated at ActivityFeed.tsx:457-459 and EventDetail.tsx:345; lib/event-grouping.ts:800 already encodes the `-main` rule.
- Scenario: A third consumer (Dashboard recent activity) needs the same rule and pastes a fourth copy; the id-suffix convention changes server-side and three sites need edits.
- Fix: `export function agentTypeOf(agentId, map?: Map<string, AgentInfo>)` next to agentOriginLabel in lib/event-grouping.ts; both call sites use it.

### [LOW] client/src/components/ui/SectionHeader.tsx:31 (ours)
- Problem: SectionHeader and PageHeader take no `className`, so every caller wraps them in a margin div: 9× for SectionHeader (SessionOverview.tsx:397/461/514/532, Dashboard.tsx:1378/1547, SessionDetail.tsx:1012/1027/1202) and 4× for PageHeader (ActivityFeed.tsx:377, KanbanBoard.tsx:329, Sessions.tsx:397, Plan.tsx:252).
- Scenario: Each new section header costs a wrapper div and an extra DOM level; snapshot diffs show `<div class="mb-3"><div class="flex ...">` at every site.
- Fix: Add `className?: string` to both, merged with `cn("flex items-center justify-between gap-3", className)` on the outer div; replace the 13 wrappers with `className="mb-3"` etc.

### [LOW] client/src/pages/Settings.tsx:1618 (ours)
- Problem: The header `actions` block was rewritten to use PageHeader in this diff but still hand-rolls `.btn-ghost` (Settings.tsx:1618) and an inline-classed `<a download>` (1610-1616); CcConfig.tsx:665-682 likewise pastes the same 150-char inline button class twice beside the new PageHeader.
- Scenario: Two button styles coexist in the same header row; a kit hover/focus-ring change leaves these three buttons behind.
- Fix: Settings: `<Button variant="ghost" icon={RefreshCw} onClick={load}>` and `<Button size="xs" icon={FileDown} asChild><a href={api.settings.exportData()} download>…</a></Button>` (or `to`-less anchor via Slot). CcConfig: `<Button size="xs" icon={History} onClick={onOpenBackups}>` and `<Button size="xs" icon={RefreshCw} loading={loading} onClick={onRefresh}>`.

### Atomicity refactors proposed

- **client/src/pages/Dashboard.tsx:187-1059 (SystemHealthTab, 875 lines inside a 1629-line page)** → pages/dashboard/SystemHealthTab.tsx (pure move) plus four local atoms it uses: HealthPanel({icon,title,aside,children}) for the 9× `card p-5 flex flex-col gap-4` + SectionHeader shell; KeyValueRow({label,children}) for the 7× `w-28 label / font-mono ml-auto value` rows; MiniStat({label,value,tone,tip}) for the 7× Tip+`text-[9px] uppercase`+mono value cells; RatioBar({label:ReactNode,pct,color,tip}) for the model/tool/subagent bar rows (3×).
  - why: Nine panels, seven key/value rows and seven mini-stats are literal copies differing only in text and colour; Dashboard.tsx cannot be read as a page while it hosts them. (size: L)

- **client/src/components/AgentCard.tsx:258-310 and client/src/components/SessionCard.tsx:168-215 (row variants)** → components/CompactRow.tsx: `{ to?, onActivate?, menu?, accent: string, badge: ReactNode, name: ReactNode, subtitle?: string, chip?: ReactNode, progress?: TodoSummary, ts: string }` rendering Clickable(kebab=false) → badge → name span → subtitle span (hidden sm:inline, title) → chip → TodoProgressIndicator → <time title={formatDateTimeFull}> → MenuButton reveal. AgentCard passes the tool EntityRef as `chip`; SessionCard passes none.
  - why: The two row layouts are identical except for the tool chip; every class string and the `<time>` block are duplicated, and the Kanban rows density will drift the moment one is tweaked. (size: S)

- **client/src/pages/Dashboard.tsx:1396-1494 and client/src/pages/SessionDetail.tsx:1067-1180 (renderAgentNode IIFEs)** → components/AgentTree.tsx: `{ agents: Agent[], roots: Agent[], childrenByParent: Map<string, Agent[]>, expanded: Set<string>, onToggle(id), renderCard(agent, depth): ReactNode, collapsedLabel(agent, descendants): ReactNode, leafMarker?: boolean }` owning the chevron IconButton (one `common:subagents.expand/collapse` key pair), GitBranch marker, `id="agent-<id>"` wrapper, indent/border, collapsed-count button and the cycle guard. Callers keep their own root/orphan selection and card props (row variant + no onClick on Dashboard; label/cost injection + conversation onClick on SessionDetail).
  - why: The recursive node renderer, chevron, collapsed-count button and ancestor cycle guard are duplicated ~100 lines each and already diverged (leaf marker, active-descendant count) in ways a render-prop absorbs. (size: M)

- **client/src/pages/ActivityFeed.tsx:462-566 and client/src/pages/SessionDetail.tsx:1339-1398 (event timeline rows)** → components/EventRow.tsx: `{ event, sessionId, isOpen, onToggle, menu, to?, id?, time: ReactNode, origin: ReactNode, trailing?: ReactNode }` rendering Clickable(to|onActivate, menu) → expander <button aria-expanded aria-label=common:eventDetail.expand/collapse> → time → AgentStatusBadge(statusFromEventType) → origin + buildEventTitle → tool EntityRef(kind=tool, sessionId) → trailing. EventDetail stays with the caller below the row.
  - why: Both rows are Clickable + expander button + status badge + origin chips + title + tool chip with the same aria wiring; only the origin chips and the trailing 'View session' link differ. (size: M)

- **client/src/pages/Sessions.tsx:533-668 (135-line table row inline in a 707-line page)** → SessionRow in pages/Sessions.tsx (or components/SessionRow.tsx): `{ session, sourceLabel?: string, isDashboardRun: boolean }` rendering the Clickable as="tr" with its seven <td>s, the entity menu and the trailing MenuButton; the page maps `paged.map((s) => <SessionRow key={s.id} … />)`.
  - why: Single caller, but the page exceeds 400 lines and the row is a self-contained unit (its own menu, transient handling, six cells) that the test file cannot target in isolation today. (size: S)


## Lens: accessibility + UX consistency of the kit adoption (Clickable/EntityRef/MenuButton/Tabs/SegmentedControl usages, primary

The atoms themselves are sound (no role/tabIndex on Clickable containers, translated kebab names, radiogroup/tablist roles, no new hex, no hardcoded aria-labels in added lines, one h1 per page). The adoption has two real dead ends: every agent chip's "Open conversation" menu item writes a DB agent id into ?transcript= but ConversationView/the server key transcripts by Claude's file-level agent id, so subagent conversations open blank; and the Kanban column-count link filters Sessions by the normalized group root while the server matches stored cwd exactly (backslashes on Windows, nested cwds on POSIX), so the linked list is empty or smaller than the count. Medium items are keyboard-equivalence gaps: AgentCard's primary control (name link) does not perform the card's onClick action on SessionDetail, deep-link targets are scrolled and ringed but never focused, ActivityFeed rows changed from click-to-expand to click-to-navigate (diverging from the identical-looking SessionDetail timeline rows) and now carry ~7 tab stops each. The rest is low: duplicate session links per SessionCard, identical "More actions" names on every row kebab, row density dropping project identity, an unlabeled actions <th>, and header-action grammar drift (icon-only vs icon+text refresh, mixed sizes, legacy pills beside the new LivePill tone).

### [HIGH] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/components/entity/entityMenu.tsx:163 (ours)
- Problem: Agent menu "Open conversation" builds routes.session(sessionId, { transcript: id }) with the DB agents.id, but transcripts are keyed by Claude's file-level agent id (agents.claude_agent_id / agent-<id>.jsonl; see server/routes/sessions.js resolveSessionTranscriptPath and the transcripts list where db_agent_id is a separate field). SessionDetail passes ?transcript= straight into ConversationView as initialTranscriptId, so for every subagent the picker shows no matching option and the transcript request returns no messages.
- Scenario: On Activity, Dashboard, EventDetail, Alerts, Workflows or Plan right-click any subagent chip -> Open conversation. The Conversation tab opens with an empty transcript and a blank <select>; the same agent clicked via the SessionDetail agents tab (navigateToAgentConversation, which maps through db_agent_id) opens fine.
- Fix: Resolve once in SessionDetail: add an effect on [transcriptParam, transcripts, agents] — if transcriptParam is not "main" and !transcripts.some(t => t.id === transcriptParam), find agents.find(a => a.id === transcriptParam) and call navigateToAgentConversation(agent) (it already maps db_agent_id -> transcript id and handleTranscriptChange rewrites the URL). Alternatively have the server accept a DB agent id in agent_id and map it to claude_agent_id.

### [HIGH] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/pages/KanbanBoard.tsx:407 (ours)
- Problem: Column count links pass the project GROUP ROOT (activeProject, produced by projectRoots: forward-slash normalized, worktree-stripped, shortest ancestor) as ?cwd=, but GET /api/sessions filters with `s.cwd IN (?)` on the stored string (server/routes/sessions.js:272). Roots never equal stored Windows cwds (backslashes) and never cover nested cwds folded into the group on POSIX.
- Scenario: Windows, Kanban with project "agent-monitor" selected: Working column shows 4; click the 4 -> /sessions?status=active&cwd=D:/projects/.../agent-monitor -> "No sessions found" because rows are stored as D:\projects\.... On POSIX a group containing repo/apps/web sessions links to a list that omits them, so the count and the list disagree.
- Fix: Send every cwd in the group instead of the root: `cwd: activeProject ? [...new Set([...rootByCwd].filter(([, r]) => r === activeProject).map(([c]) => c))] : undefined` (routes.sessions already accepts string[] and emits repeated params; same change at line 451). Same for entityMenu "sessionsInProject"/showOnBoard when a root rather than a raw cwd is passed.

### [MEDIUM] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/components/AgentCard.tsx:231 (ours)
- Problem: When `onClick` is supplied the Clickable gets onActivate={onClick} but the only primary control inside is the name EntityRef, whose href is routes.session(sessionId, { agent: id }) (?tab=agents#agent-<id>). Keyboard Enter on the card therefore re-navigates to the same agents tab and flashes the card, while a mouse click on the surface runs onClick (SessionDetail: open the agent's conversation). Same shape at line 315 (card variant) and SessionCard.tsx:135 whenever onClick is passed.
- Scenario: SessionDetail agents tab, Tab to an agent card, press Enter: page stays on Agents (URL gains #agent-…, card rings), conversation never opens. Mouse users clicking the same card land on the Conversation tab.
- Fix: When `onClick` is given, render the primary control as a button that performs it: `nameRef = onClick ? <button type="button" onClick={onClick} className="text-left truncate hover:underline decoration-dotted">{displayName}</button> : <EntityRef …/>` (kebab keeps the agent menu). Mirror in SessionCard.

### [MEDIUM] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/pages/SessionDetail.tsx:177 (ours)
- Problem: flashElement scrolls the ?event=/#agent- target into view and adds a ring, but never moves focus; the target wrappers have no tabIndex. Keyboard and screen-reader users arriving via an EntityRef/menu link ("Open timeline", "Open agent", Activity row click) are left with focus at the top of the document and must Tab through the header, tabs and every preceding row.
- Scenario: From Activity, activate a row (to=routes.session(id,{event})) with the keyboard: SessionDetail loads, timeline row 312 is expanded and ringed, but the next Tab lands on the Back button; a screen reader reads the page from the h1.
- Fix: In flashElement, after scrollIntoView: `(el.querySelector<HTMLElement>("button,a") ?? el).focus({ preventScroll: true })`, and give the two wrappers (`agent-` div at line 1109, the Clickable at line 1340) `tabIndex={-1}` so `el.focus()` works when no inner control exists. Also run the lookup in a second rAF (or retry once) because the ancestor-expansion setState commits after the first frame.

### [MEDIUM] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/pages/ActivityFeed.tsx:463 (ours)
- Problem: Activity rows changed from role=button/toggle-detail to Clickable to={sessionHref}: a plain click anywhere on the row now navigates away from the feed (losing the live buffer/pause state and scroll position), while the visually identical SessionDetail timeline rows (SessionDetail.tsx:1340) and the previous behaviour expand inline. Expansion is now only the 24px chevron.
- Scenario: User on /activity clicks the event title to peek at the payload as before -> page navigates to /sessions/<id>?tab=timeline&event=<id>; Back restores filters (URL) but the feed refetches and the paused buffer is gone.
- Fix: Use the same grammar as the timeline: `<Clickable onActivate={toggle} menu={…}>` with the expander button as primary control, and keep navigation on the existing "View session" Link, the session EntityRef and the kebab ("Open timeline" already points at the event). If navigate-on-click is intentional, apply it to the SessionDetail timeline too so both lists behave alike.

### [MEDIUM] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/pages/ActivityFeed.tsx:510 (ours)
- Problem: Each Activity row now has 7 tab stops (chevron button, project/session/agent/tool EntityRefs, View session Link, kebab) versus 2 before; 50 rows = ~350 stops on the page. Every chip destination is also available from the row kebab, so the extra stops add no keyboard capability, only travel.
- Scenario: Keyboard user wants the 10th row's payload: previously ~20 Tabs, now ~70 Tabs; screen-reader link lists show 250 near-identical "Session abcd1234"/"Bash" links.
- Fix: Add `tabbable?: boolean` (default true) to EntityRef that sets `tabIndex={tabbable ? undefined : -1}` on the Link, and pass `tabbable={false}` for the origin/tool chips inside dense Clickable rows (ActivityFeed, Dashboard recent-activity, Sessions cwd/model cells); keep the primary control and the kebab in the tab order.

### [MEDIUM] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/components/AlertsNotifications.tsx:828 (ours)
- Problem: EntityRef kind="agent" is rendered with type={null}; entityMenu only sends transcript "main" when type === "main", so for a main agent (ids are `${sessionId}-main`, server/routes/hooks.js:161) the menu's Open conversation targets ?transcript=<sid>-main, which is not a transcript id. ActivityFeed/EventDetail already infer main via id.endsWith("-main"); Alerts does not.
- Scenario: Alert row for a main agent -> right-click agent chip -> Open conversation -> Conversation tab opens empty instead of the main transcript.
- Fix: Infer once in entityMenu (fix for all callers): `const isMain = type === "main" || (type == null && id.endsWith("-main"))` and use it for the transcript param; then callers can drop their local endsWith heuristics.

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/pages/KanbanBoard.tsx:582 (ours)
- Problem: The column count became a Link whose only accessible name is the number ("link, 12") and it keeps text-gray-600 on bg-surface-3 (#4b5563 on #1a1a28 ≈ 2.3:1), below AA for an interactive 11px control; the old pill was decorative.
- Scenario: Screen reader link list shows "12", "3", "0" with no context; low-vision user cannot tell the count is clickable or read it.
- Fix: `<Link to={countHref} aria-label={t("columnCountLink", { count, status: t(labelKey) })} className="… text-gray-400 hover:text-gray-200 …">` (new kanban key x5 locales).

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/components/SessionCard.tsx:237 (ours)
- Problem: Card variant renders two EntityRef(session) links to the same href (title at line 234 and the 12-char id at 237), doubling tab stops and screen-reader link entries per card; the id line carried no link before.
- Scenario: Kanban Sessions view with 30 cards: 60 identical-target links in the tab order; SR link list shows each session twice.
- Fix: Render the id line as `<span className="font-mono" title={session.id}>{session.id.slice(0, 12)}</span>` (menu and title remain on the name link).

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/components/ui/Clickable.tsx:89 (ours)
- Problem: Every row kebab is named the generic common:ui.openMenu ("More actions"); no caller passes menuLabel, so a table of 50 sessions exposes 50 indistinguishable "More actions" buttons (WCAG 2.4.6 name-in-context).
- Scenario: Screen-reader form-controls list on /sessions: "More actions, button" x50; user cannot pick the row.
- Fix: Add common:ui.openMenuFor = "More actions for {{name}}" (x5) and pass `menuLabel={t("common:ui.openMenuFor", { name })}` from Sessions.tsx:549 (MenuButton label), AgentCard/SessionCard row+card kebabs, AlertsNotifications, ActivityFeed and Dashboard rows.

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/components/AgentCard.tsx:260 (ours)
- Problem: Row variant subtitle is only type/model and omits the project; the Dashboard tree (all projects) and Kanban rows density with "All projects" therefore show main agents with no project identity at all, whereas the card variant showed cwd in the subtitle and now shows ProjectBadge.
- Scenario: Dashboard with three active mains named "Fix login bug" in three repos: rows are indistinguishable; hovering reveals nothing (no title).
- Fix: For main agents include `pathBasename(session?.cwd)` first in rowSubtitle and set `title={session?.cwd}` on the subtitle span (SessionCard row already does this for named sessions); optionally prepend the projectColor(root).dot swatch when projectRoot is given.

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/pages/Sessions.tsx:520 (ours)
- Problem: The last column now holds the row action menu but its header cell is an empty <th>, so the column has no name for assistive tech.
- Scenario: Screen reader in table mode announces "column 8, blank" over every kebab.
- Fix: `<th className="w-10"><span className="sr-only">{t("common:actions")}</span></th>` (key exists).

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/pages/SessionDetail.tsx:814 (ours)
- Problem: The header session chip is a link to routes.session(id) — the page itself — so activating it pushes a duplicate history entry and drops ?tab=/?transcript=; the chip only exists to carry the menu/title.
- Scenario: Click the id chip in the header while on the Conversation tab: URL loses ?tab=conversation, page flips to Agents, Back returns to the same page.
- Fix: Add `link?: boolean` (default true) to EntityRef that renders the span + ContextMenuFor when false, and use `link={false}` here.

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/pages/Workflows.tsx:606 (ours)
- Problem: Header action grammar diverges across pages: refresh is icon-only IconButton on Workflows/Activity/SessionDetail (sizes md, md, sm) but ghost Button with text on Dashboard/Kanban (md) and Sessions/Analytics (sm); the new LivePill tone (emerald-300, animate-pulse) sits next to untouched hand-rolled emerald-400/animate-pulse-dot pills (Dashboard health "Active", Run "live", SessionDrillIn tool pill) for the same live/active meaning.
- Scenario: Switching Dashboard -> Activity -> Sessions the refresh control changes label presence and size three times; Dashboard health card shows a different green than its own header pill.
- Fix: Pick one: `<Button variant="ghost" size="sm" icon={RefreshCw}>{t("common:refresh")}</Button>` on every PageHeader (Workflows/ActivityFeed/SessionDetail), and swap the health Active/Offline span (Dashboard.tsx SystemHealthTab integration header) for `<Badge tone={installed ? "success" : "neutral"} size="xs" dot pulse>`.

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/components/entity/EntityRef.tsx:92 (ours)
- Problem: Clickable lets shift+right-click / an active text selection through to the native menu, but EntityRef's ContextMenuFor never does, so the same gesture yields the kit menu on a chip and the browser menu on the row around it; outside a Clickable there is no way to reach the native link menu on a chip.
- Scenario: SessionDrillIn header chip: shift+right-click opens the entity menu; the same gesture on a Sessions row shows the browser menu.
- Fix: Pass `disabled={nativeMenu}` to ContextMenuFor from an `onContextMenuCapture` handler on the Link that sets a ref when `e.shiftKey || window.getSelection()?.toString()` (mirror Clickable.tsx:74-81), or lift that check into ContextMenuFor itself so both share it.

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/components/ProjectBadge.tsx:149 (PRE-EXISTING, not ours)
- Problem: The reveal-folder button is an unpadded 12px icon (w-3 h-3) at opacity-60, far below the 24px target floor the kit pins for IconButton; it is now rendered on every AgentCard/SessionCard.
- Scenario: Touch user on a Kanban card tries to open the folder and hits the project link beside it instead.
- Fix: `<IconButton icon={FolderOpen} size="xs" label={t("project.open")} onClick={open} className="-my-1 opacity-60 hover:opacity-100" />` (icon stays 14px, hit area 24px).

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/components/Tabby/TabbyPanel.tsx:110 (PRE-EXISTING, not ours)
- Problem: Panel still ships hardcoded English accessible names (aria-label="Tabby companion", "Close Tabby", ActionButton labels "Run Claude", "Activity", "Sessions", "Errored", "Clear alerts"); the i18n audit does not cover this file, and the change-set touched it without translating.
- Scenario: Korean UI: every Tabby control is announced/tooltipped in English.
- Fix: Add a `tabby` block to common.json (x5) and replace each literal with t(); the file already imports the router helper this change added.

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/plan/Plan.tsx:744 (PRE-EXISTING, not ours)
- Problem: TaskCard opens the drawer via a div onClick with no keyboard path; this change added the ?task= deep link and EntityRef chips inside the card but left the card itself mouse-only.
- Scenario: Keyboard user cannot open any task drawer on /plan; Tab skips straight from the checkbox to the agent chip.
- Fix: Wrap the task text in `<button type="button" onClick={onSelect} className="text-left w-full">…</button>` (the Checkbox and agent chip already stop propagation), or convert the card to `<Clickable onActivate={onSelect}>` with that button as primary control.

### [LOW] D:/projects/production/ai/agentic-ai/agent-monitor/client/src/components/Sidebar.tsx:1063 (ours)
- Problem: EntityRef chips inside the aria-modal ConnectionStatusModal open a Radix ContextMenu that portals to document.body, outside the aria-modal dialog, so screen readers treat the menu as inert content while the modal is open.
- Scenario: VoiceOver/NVDA user opens the status modal, invokes the context menu on an event type: focus moves into the menu but items are not announced/navigable.
- Fix: Let ContextMenuContent/ContextMenuFor accept a `container` prop forwarded to Primitive.Portal, and pass the dialog element ref from ConnectionStatusModal; or render the modal without aria-modal and rely on the existing focus handling.

### Atomicity refactors proposed

- **D:/projects/production/ai/agentic-ai/agent-monitor/client/src/components/entity/entityMenu.tsx (agent kind) + ActivityFeed.tsx:456, EventDetail.tsx entityChip agent_id case** → one `isMainAgent(id, type)` helper inside entityMenu.tsx used by entityMenu and exported for callers; ActivityFeed/EventDetail/Alerts drop their local endsWith("-main") heuristics
  - why: The same main-agent inference is written three ways (and omitted in Alerts); one home fixes the transcript target for every chip. (size: ~15 lines)

- **Kebab reveal class string duplicated in Clickable.tsx:90, AgentCard.tsx (row+card), SessionCard.tsx (row+card), Sessions.tsx ROW_KEBAB_CLASS** → `export const kebabRevealClass` from components/ui/DropdownMenu.tsx (or a `reveal` prop on MenuButton) consumed by all five sites
  - why: Five copies of a 6-utility string; any tweak (e.g. focus-visible) has to be made five times. (size: ~10 lines)

- **D:/projects/production/ai/agentic-ai/agent-monitor/client/src/pages/SessionDetail.tsx deep-link effects (lines ~560-645: ?tool_name/?agent_id seed, ?event= retry, #agent- expand) + flashElement** → `hooks/useDeepLinkTarget.ts` (flash/focus helper + once-per-location.key guard) and a `useTimelineEventTarget` hook; SessionDetail keeps only the callbacks
  - why: SessionDetail grew three ref-guarded effects with subtly different once-semantics; isolating them makes the focus fix and the rAF timing testable without rendering the whole page. (size: ~120 lines moved)

- **D:/projects/production/ai/agentic-ai/agent-monitor/client/src/pages/Dashboard.tsx SystemHealthTab (lines 187-1060)** → components/dashboard/SystemHealthTab.tsx
  - why: The i18n pass made the health tab ~870 lines inside a 1600-line page file; it shares no state with Dashboard() beyond the data scope hook. (size: ~870 lines moved)

- **D:/projects/production/ai/agentic-ai/agent-monitor/client/src/pages/Sessions.tsx row body (lines 533-660)** → `SessionRow` component in the same file taking {session, sourceLabels, dashboardRunIds}
  - why: The Clickable/tr adoption pushed the row to ~130 lines of JSX inside a map; a named component lets the menuLabel/aria fixes and a row test land without touching the page. (size: ~130 lines moved)


## Lens: correctness + behavior regressions (flows traced end-to-end: Dashboard, Kanban, Sessions, SessionDetail deep links, Acti

Most flows hold: URL⇄state sync on ActivityFeed/Kanban/Workflows/Plan has no loops (replace everywhere, single writer per tick), the ?transcript= round-trip is guarded by the equality check, ?tool_name/agent_id seeding is once-per-location.key, Radix TabsContent forceMount+hidden override verified against the installed source, jsonl agent-id scheme and main-agent id convention verified server-side, Escape stopPropagation is capture-phase so the Sidebar modal stays open. Seven real defects found. One is high: the Sessions palette "Clear filters" action now issues two setSearchParams writes in one tick (react-router builds each from the render-closure params), so the second write re-inserts the status the first removed — the status filter can no longer be cleared. One medium: Kanban column-count links pass the normalized project root as `cwd`, but /api/sessions matches `cwd IN (...)` exactly, so on Windows (backslash cwds) or nested cwds the linked Sessions list is empty. The rest are low: WS-pushed events without `id` produce an "undefined" event menu on the Dashboard; the #agent- flash is scheduled in the same tick as the ancestor expansion and can miss the not-yet-committed card; the ?event= handler runs against a previous session's still-loaded events (no reset on :id change) and can append a mis-offset batch; on SessionDetail the agent name link now self-links instead of opening the conversation; the plan fixture lacks the new required sessionId so the Plan render test exercises /sessions/undefined links.

### [HIGH] client/src/pages/Sessions.tsx:289 (ours)
- Problem: `sessions.clearFilters` calls `setFilter("")` (useUrlTab → its own setSearchParams) and then `setCwds([])` (a second setSearchParams) in the same tick. react-router's functional setSearchParams applies the updater to `new URLSearchParams(searchParams)` captured at render (verified in node_modules/react-router/dist/development/lib/dom/lib.js:753-765), so the second navigate("?…", {replace:true}) is built from params that still contain `status` and overwrites the first write. Before this change `cwds` was local state so only one URL write happened.
- Scenario: Open /sessions?status=active (or set the Active pill), run the palette action "Clear filters" → URL is rewritten to `?status=active` again, the pill stays selected and the list stays filtered. Same when both status and cwd are set: cwd clears, status survives.
- Fix: Make the action one URL write: `usePaletteAction("sessions.clearFilters", () => { setSearchInput(""); setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete("status"); n.delete("cwd"); return n; }, { replace: true }); });` (drop the separate setFilter/setCwds calls). Add a test that renders at `/sessions?status=active&cwd=/a` and asserts both params are gone after the action.

### [MEDIUM] client/src/pages/KanbanBoard.tsx:407 (ours)
- Problem: Column count links (also line 451) pass `cwd: activeProject`, which is a *normalized group root* from `projectRoots` (backslashes → slashes, worktree/nested dirs folded to the shortest ancestor). `/api/sessions` filters with `s.cwd IN (?)` on the raw stored cwd (server/routes/sessions.js:271-273), so the root never matches on Windows and only matches the exact-root sessions on POSIX.
- Scenario: On this Windows box: pick the `agent-monitor` project tab, click the `3` badge on the Active column → /sessions?status=active&cwd=D%3A%2Fprojects%2F…%2Fagent-monitor → server compares against `D:\projects\…\agent-monitor` → 0 sessions. On POSIX with sessions in repo/apps/web folded under repo, those are counted in the column but absent from the linked list.
- Fix: Send the raw cwds that fold onto the active root as repeated params (routes.sessions already accepts string[]): `const projectCwds = activeProject ? [...new Set(sessions.filter((s) => s.cwd && rootByCwd.get(s.cwd) === activeProject).map((s) => s.cwd as string))] : undefined;` and use `cwd: projectCwds` in both countHref calls.

### [LOW] client/src/pages/Dashboard.tsx:1576 (ours)
- Problem: Recent-activity rows build `entityMenu({ kind: "event", id: event.id, … })` unconditionally, but WS `new_event` payloads for Interrupted / Compaction / SubagentJsonlImported carry no `id` (server/routes/hooks.js:132, 1050, 1451) and are pushed into `recentEvents` as-is (Dashboard.tsx:1219-1228). SessionDetail guards this (`event.id != null ? entityMenu(...) : undefined`), Dashboard does not.
- Scenario: A session is interrupted → the "… interrupted by user" row appears via WS; right-click it → menu header reads `undefined`, "Copy event ID" copies the string "undefined", "Open timeline"/"Copy link" resolve to `/sessions/<id>` without `tab=timeline`.
- Fix: `menu={event.id != null ? entityMenu({ kind: "event", id: event.id, … }, { t, copy: copyText }) : undefined}` (row `to` already degrades correctly because routes.session omits an undefined event).

### [LOW] client/src/pages/SessionDetail.tsx:644 (ours)
- Problem: The `#agent-<id>` effect calls `setExpandedAgents(...)` and `flashElement()` in the same pass. `flashElement` looks the card up in a single requestAnimationFrame, but the expansion is a DefaultLane update committed from a Scheduler macrotask; when the agents fetch resolves right before a frame boundary the rAF runs first, `document.getElementById("agent-<id>")` is null for a card nested under a collapsed parent, and `handledAgentHashRef` is already set so it never retries.
- Scenario: Open /sessions/S?tab=agents#agent-l2 where l2 sits under a collapsed l1: the tree expands but nothing scrolls or rings (intermittent, timing-dependent; jsdom test cannot reproduce).
- Fix: Split the work: effect 1 (deps [agents, agentHash, location.key]) marks handled, expands ancestors and stores `pendingFlashRef.current = agentHash`; effect 2 (deps [expandedAgents, agentHash]) does `if (pendingFlashRef.current && document.getElementById("agent-"+pendingFlashRef.current)) { flashElement(...); pendingFlashRef.current = null; }`. Same shape works for the ?event= flash if expandedEvents ever gates the row.

### [LOW] client/src/pages/SessionDetail.tsx:618 (ours)
- Problem: `events`, `eventsTotal`, `eventsLoaded`, `handledEventRef` and `eventRetriedRef` are never reset when the `:id` param changes (the load effect at line 384 only refetches; SessionDetail is not remounted between two /sessions/:id locations). The ?event= effect therefore runs against the previous session's still-loaded events with `eventsLoaded === true`.
- Scenario: Visit /sessions/A, then Forward/Back into /sessions/B?tab=timeline&event=N: effect sees A's events, misses N, `events.length < eventsTotal` (A's) → `loadMoreEvents()` requests B at offset A.length; `loadEvents` then sets B's first batch and the late `setEvents(prev => [...prev, ...more])` appends a mis-offset slice → duplicated/skipped timeline rows, and `eventRetriedRef` is consumed so the deep link announces "not loaded".
- Fix: In the `[id, scope]` load path (or a small `useEffect(() => {...}, [id])`) reset: `setEvents([]); setEventsTotal(0); setEventsLoaded(false); handledEventRef.current = null; eventRetriedRef.current = null;` before refetching.

### [LOW] client/src/components/AgentCard.tsx:231 (ours)
- Problem: When `onClick` is supplied (SessionDetail agents tab: `onClick={() => navigateToAgentConversation(agent)}`), the surface calls onClick but the name — the most prominent target — is now an EntityRef link to `routes.session(sessionId, { agent: id })`, i.e. `?tab=agents#agent-<self>`. Clicking the name pushes a self-navigation that just flashes the same card; before this change clicking the name opened the agent's conversation.
- Scenario: On /sessions/S agents tab click the agent name "qa" → URL becomes /sessions/S?tab=agents#agent-<id>, history entry pushed, card rings, conversation does not open. Clicking the padding beside the name still opens it.
- Fix: Add an optional `nameTo?: string` prop (or `nameOnClick`) to AgentCard; when `onClick` is given and no override is passed, render the name as `<button type="button" onClick={onClick} className=…>` (still the primary control, still ignored by Clickable's inner-control check) so name and surface do the same thing; SessionDetail keeps the entity menu on the card for the deep link.

### [LOW] client/src/plan/__tests__/Plan.render.test.tsx:122 (ours)
- Problem: `PlanAgent.sessionId: string` is now required and Plan.tsx links with `routes.session(agent.sessionId)`, but the fixture the client test renders (test/fixtures/plan/ledgerflow/expected/model.json — 26 `"session"` prefixes, 0 `"sessionId"`) was not updated. The drawer's "Open session" link and every agent EntityRef render as /sessions/undefined?… and the new test passes without checking an href, so a broken link cannot be caught here.
- Scenario: Run the Plan render test with the drawer open: `screen.getByRole("link", { name: /Open session/ })` has href `/sessions/undefined`; a future regression in the sessionId plumbing goes unnoticed.
- Fix: Add `"sessionId": "<full id>"` next to each `"session"` in the fixture (server/plan/join.js now emits it, so regenerating the fixture from the join is the cleanest), and extend the `?task=` test with `expect(screen.getByRole("link", { name: /open session/i })).toHaveAttribute("href", "/sessions/<full id>")`.

### Atomicity refactors proposed

- **client/src/pages/SessionDetail.tsx:555-645 (seed-filters, ?event=, #agent- effects + their 4 refs)** → client/src/hooks/useSessionDeepLinks.ts exporting useSessionDeepLinks({ agents, events, eventsTotal, eventsLoaded, eventsLoadingMore, loadMoreEvents, setFilters, setExpandedEvents, setExpandedAgents })
  - why: Three independent deep-link state machines with once-per-key refs are interleaved in a 1300-line page component; two of the findings above (flash race, cross-session reset) need per-effect ordering that is easier to reason about and unit-test in a hook rendered with renderHook + MemoryRouter. (size: ~90 lines moved, no behavior change)

- **client/src/pages/Sessions.tsx:133-165 (useUrlTab status + cwd getAll/append + q seed)** → one `useSessionsUrlFilters()` returning { status, cwds, q, setStatus, setCwds, clear } backed by a single setSearchParams updater
  - why: Two independent useSearchParams writers on the same page is what produced the clear-filters clobber; a single owner makes multi-key writes atomic by construction. (size: ~40 lines)


## Lens: UI kit: client/src/components/ui/*, components/entity/*, lib/routes.ts, lib/clipboard.ts, lib/cn.ts, test-setup.ts and t

Kit matches the spec tables (Button/Badge tones and sizes, Tabs/Segmented classes, menu item classes, entityMenu item lists and hrefs, routes param names/encoding/tab precedence/hash order all verified against the pages that read them; twMerge handles the repo tokens; tsc-strict, no any). asChild/forwardRef pairs are correct (Link, IconButton->Button->button, Slot+Slottable). Escape stopPropagation at Radix's document-capture listener does suppress every existing bubble-phase window/document keydown listener (Sidebar, Run, Workflows, CcConfig, CommandPalette) — verified with a throwaway probe. Real defects: (1) menu z-[80] sits under the z-[100] Sidebar ConnectionStatusModal that now hosts EntityRef chips, and modal ContextMenu also freezes body pointer events; (2) touch long-press on an EntityRef nested in a Clickable opens BOTH context menus (probe confirmed data-state=open on both triggers and two role=menu nodes) because EntityRef only stops the mouse contextmenu path; (3) a click that ends a drag-selection inside a Clickable navigates; (4) execCommand copy fallback runs synchronously inside onSelect while Radix's trapped FocusScope is still mounted, so its textarea focus is reverted before execCommand (plausible, browser-only). Plus lows (menu={false} still blocks the parent menu, kebab default for as="tr", disabled `to` items navigate, model pricing always claude-pricing, `to`+disabled Button keyboard-navigable, copyText double-toast in CodexConfigExplorer, CopyButton lift not done, ProjectBadge<->entity import cycle) and test gaps. Bundle: App.tsx has no lazy routes and vite has no manualChunks, so the ui barrel has no per-page cost; Radix packages are pure ESM — no finding.

### [HIGH] client/src/components/ui/ContextMenu.tsx:16 (ours)
- Problem: menuContentClass pins the portalled menu at z-[80], but the app has z-[100] overlays (Sidebar ConnectionStatusModal at Sidebar.tsx:933, UpdateNotifier:199) and Group D put EntityRef chips inside that modal (Sidebar.tsx:1063, 1153). Radix Popper copies the content's computed z-index onto its fixed wrapper, so the menu renders behind the modal backdrop; because the ContextMenu is modal it also sets body pointer-events:none.
- Scenario: Open the sidebar connection-status modal, right-click an event-type chip: nothing visible appears, the modal stops responding to clicks (body pointer-events:none) until the user presses Escape.
- Fix: Set the shared class to z-[110] (above every existing overlay; add a `zIndex.menu` token or comment listing the overlay ladder) in menuContentClass; DropdownMenuContent inherits it.

### [MEDIUM] client/src/components/ui/ContextMenu.tsx:54 (ours)
- Problem: Nested ContextMenuFor triggers (EntityRef inside Clickable) both start Radix's 700 ms long-press timer on the same touch/pen pointerdown; EntityRef only stops propagation of the mouse `contextmenu` event (EntityRef.tsx:86). Probe test confirmed: one touch pointerdown on a tool chip inside a Clickable row leaves both triggers data-state=open and two role=menu nodes mounted (two modal layers).
- Scenario: On a phone/tablet, long-press the session-name chip in a Sessions row or the tool chip in a Dashboard recent-activity row: two menus open stacked; Escape/tap-outside closes only the top one.
- Fix: In ContextMenuFor pass `onPointerDown={(e) => { if (e.pointerType !== "mouse") e.stopPropagation(); }}` to ContextMenuTrigger (runs before Radix's composed handler, keeps the inner timer, prevents the outer one). Add a test: fire a pointerdown with pointerType "touch" on the nested link, wait 800 ms, expect exactly one `[data-state=open]` trigger.

### [MEDIUM] client/src/components/ui/Clickable.tsx:197 (ours)
- Problem: handleClick navigates on any plain click that is not on an inner control, including the click event the browser fires after a mouse drag-selection that starts and ends inside the row.
- Scenario: On /sessions drag across a session name or cwd text to select it (mousedown and mouseup both inside the <tr>) → the row navigates to the session page and the selection is lost.
- Fix: At the top of handleClick: `const sel = window.getSelection(); if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;` (mirrors the existing contextmenu selection pass-through). Add a Clickable test that creates a Range over the row text and asserts navigate is not called.

### [MEDIUM] client/src/components/ui/Menu.tsx:221 (ours)
- Problem: Action items run `onSelect` synchronously inside Radix's handleSelect, before rootContext.onClose(); at that moment the modal menu's FocusScope (trapped) is still mounted. lib/clipboard's fallback (clipboard.ts:147-159) calls textarea.select(), whose focusin is immediately reverted by FocusScope's document focusin handler, so execCommand("copy") runs with focus back on the menu item. Not reproducible in jsdom; reasoning from @radix-ui/react-focus-scope handleFocusIn.
- Scenario: Dashboard opened over plain HTTP from another machine (navigator.clipboard undefined — the exact case the fallback exists for): right-click a session → Copy session ID → toast says Copied but the clipboard is unchanged.
- Fix: Defer actions until the menu has closed: `onSelect={onSelect ? () => { window.setTimeout(() => void onSelect(), 0); } : undefined}` on both Item branches (transient user activation survives a 0 ms timeout, so the async Clipboard API path is unaffected). Alternatively make the fallback select a hidden non-editable <span> via a Range instead of focusing a textarea.

### [MEDIUM] client/src/components/ui/__tests__/ContextMenu.test.tsx:182 (ours)
- Problem: The Escape contract the kit exists for — a window/document bubble keydown listener (every existing modal) must NOT fire when a menu consumes Escape — is untested; the test only checks the menu closes. Also untested: contextmenu pass-through when text is selected (Clickable.tsx:224), nested EntityRef-in-Clickable long-press, Enter on a `to` item navigating and closing, and PageHeader/SectionHeader/LivePill/Badge have no tests at all.
- Scenario: Someone removes `e.stopPropagation()` from onEscapeKeyDown while adding a prop; all 79 kit tests still pass, and Escape in an EntityRef menu inside the Sidebar connection modal now also closes the modal.
- Fix: Add: `const win = vi.fn(); window.addEventListener("keydown", win); open menu; fireEvent.keyDown(menu,{key:"Escape"}); await waitFor(menu gone); expect(win).not.toHaveBeenCalled()` (verified passing with a probe); a Clickable test that sets a Range selection and asserts contextmenu opens no menu; a touch long-press nesting test; and `fireEvent.keyDown(linkItem,{key:"Enter"})` asserting the MemoryRouter location changed and the menu closed.

### [LOW] client/src/components/entity/EntityRef.tsx:86 (ours)
- Problem: `onContextMenu={(e) => e.stopPropagation()}` is attached even when `menu={false}`, so a chip that opted out of its own menu also swallows the enclosing Clickable's menu.
- Scenario: A row renders `<EntityRef kind="tool" menu={false}>` inside `<Clickable menu={entityMenu(event)}>`; right-click on the chip shows the native browser menu instead of the row menu.
- Fix: `onContextMenu={menu ? (e) => e.stopPropagation() : undefined}`.

### [LOW] client/src/components/ui/Clickable.tsx:195 (ours)
- Problem: `kebab ?? true` also applies to `as="tr"`, where the kebab would be a <button> directly inside <tr> (invalid DOM; browsers hoist it out of the table, React warns).
- Scenario: A future table caller writes `<Clickable as="tr" menu={items}>` without `kebab={false}`; the kebab renders outside the table above the tbody.
- Fix: `const showKebab = Boolean(menu) && (kebab ?? Tag !== "tr");`

### [LOW] client/src/components/ui/Menu.tsx:215 (ours)
- Problem: A `to` item with `disabled: true` gets Radix's aria-disabled and the opacity class, but the slotted react-router <Link> still navigates on click (Radix skips handleSelect when disabled, then Link's own handler runs because nothing called preventDefault).
- Scenario: Any caller passes `{ label, to, disabled: true }`; clicking the greyed item navigates.
- Fix: `<Link to={to} aria-disabled={disabled || undefined} onClick={disabled ? (e) => e.preventDefault() : undefined} tabIndex={disabled ? -1 : undefined}>`, or render the non-link Item branch when disabled.

### [LOW] client/src/components/entity/entityMenu.tsx:206 (ours)
- Problem: model → pricingRules always links `routes.settings("claude-pricing")`; Settings has a separate `#gpt-pricing` section (Settings.tsx:1964) for Codex/GPT models.
- Scenario: Right-click a `gpt-5-codex` model chip on a Codex session → Pricing rules → lands on the Claude pricing table.
- Fix: `routes.settings(/^(gpt|o\d|codex)/i.test(ref.model) ? "gpt-pricing" : "claude-pricing")` and add the case to entityMenu.test.

### [LOW] client/src/components/ui/Button.tsx:75 (ours)
- Problem: With `to`, `disabled`/`loading` only add aria-disabled + `aria-disabled:pointer-events-none`; the <a> stays in the tab order and Enter navigates.
- Scenario: `<Button to="/run" loading>` — Tab to it and press Enter → navigation while the caller believes the control is inert.
- Fix: When `isDisabled && to`, render `<Link to={to} tabIndex={-1} onClick={(e) => e.preventDefault()}>` (or drop `to` and render the plain disabled <button>).

### [LOW] client/src/lib/clipboard.ts:165 (ours)
- Problem: copyText always toasts; CodexConfigExplorer (lines 1208, 1286) keeps its own inline “Copied” state, so the lift added a second, previously absent toast there.
- Scenario: Codex config → copy a profile path: the button flips to Copied AND the bottom action toast says Copied.
- Fix: Either drop the inline `copied` state in CodexConfigExplorer (toast is now the feedback) or add `copyText(value, { announce = true })` and pass `announce: false` from those two callers.

### [LOW] client/src/components/event-views/primitives.tsx:122 (ours)
- Problem: Spec §0 says CopyButton now calls lib/clipboard.copyText; it still calls navigator.clipboard.writeText directly and swallows the error, so event-detail copy silently does nothing on plain-HTTP remote sessions.
- Scenario: Dashboard reached via http://<lan-ip>:port, expand an event, click the copy icon on a payload → no copy, no feedback.
- Fix: `async function copy() { if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }` and import copyText from ../../lib/clipboard.

### [LOW] client/src/components/entity/entityMenu.tsx:15 (ours)
- Problem: Import cycle: entityMenu.tsx → ../ProjectBadge (helpers) while ProjectBadge.tsx:23 → ./entity (EntityRef). Works today because both sides only use the bindings at call time, but any future top-level use (e.g. a module-level `entityMenu(...)` constant or PALETTE lookup in the barrel) becomes an undefined-at-eval error, and vi.mock of either module behaves surprisingly.
- Scenario: Someone adds `export const PROJECT_TONE = projectColor("x")` style top-level code to ProjectBadge, or hoists a menu constant in entity/index.ts → TDZ/undefined at import time depending on which module the page imports first.
- Fix: Move normalizeCwd/projectRootOf/projectLabel/projectRoots/projectColor to client/src/lib/project.ts; ProjectBadge and entityMenu both import from there.

### Atomicity refactors proposed

- **client/src/components/ui/Clickable.tsx:236 kebab reveal class string** → export `kebabRevealClass` from Clickable.tsx (or add `reveal?: boolean` to MenuButton that applies it) and replace the five caller copies
  - why: the hover/focus-within/coarse-pointer/open visibility rule is one contract; today a fix (e.g. adding data-[state=open]) must be applied in six places and the Sessions constant already drifts by being defined page-side (size: 1 string × 6 copies (Clickable.tsx:236, AgentCard.tsx:303 & 353, SessionCard.tsx:208 & 250, Sessions.tsx:119 ROW_KEBAB_CLASS))

- **client/src/components/ui/ContextMenu.tsx:24-41 and DropdownMenu.tsx:91-113 Content wrappers** → one `withPortalAndEscapeStop(Primitive)` helper (or a shared `stopEscape` handler constant) used by both Content components
  - why: the Portal + menuContentClass + onEscapeKeyDown stopPropagation wrapper is duplicated verbatim; the z-index and Escape fixes above must be made twice otherwise (size: 2 × ~18 lines)
