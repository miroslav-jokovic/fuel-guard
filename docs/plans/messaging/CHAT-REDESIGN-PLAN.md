# Office chat — the workspace redesign (2026-10-26)

Decision log for the redesign of `/chat`. Companion to `OFFICE-CHAT-PLAN.md`, which owns the data model,
the transport, the ledger and the work queue CH1–CH12; this plan owns what the page looks like and how it
is laid out, and nothing it decides needs a migration or an API change. Decisions here are **D-CHATUI**,
questions **Q-CHATUI**, work items **CR**.

## 0. Why this plan exists

On 2026-10-26 the owner asked for the chat page to be analysed with the design skills in this repo and
redesigned "to be modern and enterprise grade", with research. The audit that day (Rams' ten principles, evidence
from the rendered page; the `DESIGN-IS-2026-10-26/` folder with its screenshots stays local, as the
2026-10-15 audit's did — §1 carries what the redesign acts on) scored **17/30** and returned **REDESIGN**:
the page was built as a document page — `PageHeader`, a Chats | Teams tab strip, three `BaseCard`s in
a grid whose height is a hand-kept formula — around a surface that is a workspace. Measured at
1440×900 with a conversation open, the message log was **302 px of 900** (34 %), the grid began 281 px
down, and the composer block took 165 px; at 390×844 an open channel showed two posts. Restyling the
bubbles inside that pane would keep the central failure, so the structure changes.

## 1. What exists (measured 2026-10-26 at 2250dc6)

Measured on the page rendered against fixtures at 1440×900 and 390×844; the parts the redesign acts on:

- **A document skeleton for a workspace.** `ChatPage.vue` is `space-y-6` → `PageHeader` → `AppTabs` →
  a card grid at `h-[calc(100dvh_-_22rem_-_…)]` / `lg:…18rem…`, re-measured after every addition
  ("3rem more than before CH5c"). `AppShell` has had a full-bleed outlet since D-DR5 (`meta.fullBleed`:
  no rhythm, no gutters, a height) that the live map and the dispatch board use; `/chat` does not.
- **Two worlds.** Chats and Teams are tabs; switching writes `query: {}`, so the open conversation is
  dropped, and a conversation and a channel are never in one list. `ChatTeamsView.vue` repeats the
  two-card layout with a third card for replies.
- **Bubbles.** Own lines right-aligned in solid `bg-action-primary`, others in `bg-surface-subtle`,
  `max-w-[75%]`; every line carries `MM/DD/YYYY h:mm AM` at 11 px; no avatars, no grouping of a
  sender's run, no day dividers, nothing marks where unread starts.
- **Chrome.** Per team the rail always shows New channel · Add people · Leave team as ghost text
  buttons; the channel header always shows Leave channel; 24 buttons in `<main>` with one channel open.
- **Right.** Loading / failed / empty are three answers everywhere (D-US5); the optimistic send with
  Retry, Seen, edited, removed; the URL holds the open item; tokens only; one lazy chunk, no library.

## 2. What the field does now (research 2026-10-26)

Searched and fetched that day (primary sources where they exist; the agent's full report with URLs is
in the session, the load-bearing ones are cited here). What recurs across Slack (2023 sidebar, the
2025–2026 changelog), Microsoft Teams (new chat-and-channels, 2024 → the Muted section rollout of
Sep–Oct 2026), Linear, Front's 2025 inbox, Google Chat's 2025 side panel, the W3C ARIA patterns and the
MUI X / Stream chat components:

| Practice | Where it is seen | Taken as |
|---|---|---|
| Flat message rows: avatar, name and time on the first line of a same-sender run, continuation lines collapsed; the grouping window is 5 min in every library default that states one (MUI X Chat, Stream) | Slack (Clean/Compact differ only in avatar and spacing), Mattermost, Rocket.Chat, Discord, Google Chat | D-CHATUI4 |
| One list of chats and channels, with sections, and a Muted section at the bottom that never adds to the badge | Teams new chat-and-channels (2024), Muted section (MC1269864, 2026); Slack custom sections | D-CHATUI2, D-CHATUI3 |
| Threads open in a side panel beside the channel; the parent shows its reply count | Slack, Teams "Threads" layout (GA 2025), Google Chat inline threading (2025), Mattermost | D-CHATUI9 |
| Unread as quiet emphasis — bold name, a small count — not an alarm colour; Slack desaturated its badges because red "felt demanding" | Slack sidebar post (2023), Focus mode (2026), Teams bold-only for muted, Linear, Front | D-CHATUI5 |
| A "New" line at the first unread message; auto-scroll only when already near the bottom; never move the reader against their intent | shadcn message-scroller, Stream, setproduct's chat-UI measurements | D-CHATUI6, kept from CH6a |
| Per-message time on hover or focus; the day divider carries the date; "Edited" on the row; a deleted message keeps its place | Slack, Discord (Cozy), MUI X | D-CHATUI4 |
| The log is `role="log"`, `aria-live="polite"`, `aria-relevant="additions"`, inside a focusable labelled region; never `assertive` | WCAG technique ARIA23, MDN, shadcn | D-CHATUI11 |
| Enter sends, Shift+Enter breaks, IME-safe; the composer grows to a cap, then scrolls; send stays inside the field at ≥ 24 px | Slack, Teams, open-source composers; WCAG 2.5.8 | D-CHATUI8 (Enter/Shift+Enter is CH2's already) |
| Message measure capped around 65–80 ch (≈ 720–768 px) | setproduct (Claude.ai, ChatGPT, Perplexity measured), an 80ch cap in an OSS chat | D-CHATUI12 |
| Hover-only controls always have a keyboard and a touch path; nothing important lives only in a dropdown (Front's 2025 redesign drew that complaint) | Slack mobile, Front community | D-CHATUI7 |
| Two densities behind one setting (Clean/Compact, Comfy/Compact, Standard/Compact) | Slack, Teams, Mattermost, Rocket.Chat | Q-CHATUI2 — not now |
| Keyboard-first: a switcher, J/K in lists, Esc marks read, Up from an empty composer into the log | Slack, Linear, Intercom, Front | Q-CHATUI3 — after this |

Not found, so not claimed: Slack's and Teams' exact sidebar widths and avatar sizes; whether Teams chat
still right-aligns own messages; formatting-toolbar conventions.

## 3. The direction

Operate mode: the visitor completes a task — read, answer, follow — many times a day beside the
dispatch board, so scanability and consistency outrank expression, and the brand lives in the details the
house system already owns. The surface inherits the Silvicom world (`docs/DESIGN-SYSTEM-CONTRACT.md`,
tokens, `@silvicom/ui`); nothing new is invented at the token level.

- **THESIS:** chat is a workspace, not a document. One rail of everything you are in, one stage, one
  thread panel, edge to edge under the top bar. It refuses the category default this page shipped with
  — two tabs over two cards over bubbles — and the consumer default of own lines on the right.
- **OWN-WORLD:** canvas behind, surface for the stage, hairlines (`edge-subtle`) instead of card rings;
  28 px initial avatars; the brand accent only where attention is owed (the unread count) and
  `action-primary` only on the one act that sends. With the words removed, the page is three columns
  of hairlines and a row of small circles.
- **STORY:** the reader sees in the rail where attention is owed, opens it, reads a day-dated log of
  people talking in order, and answers in a field that grows with the answer. A thread opens beside
  the channel; nothing that was open is lost.
- **FIRST VIEWPORT (1440×900, sidebar collapsed as a workspace does, D-DR25):** rail 18 rem on the left —
  search, a New button, then *Chats*, *Dispatch*, *Shop*, *Muted*; the stage fills the rest — a 3.5 rem
  header (avatar or `#`, name, who is in it, a kebab), the log, the composer along the bottom; a thread
  opens as a 24 rem panel on the right at `xl`.
- **FORM:** the workspace triptych — chosen over (a) a two-pane inbox with threads inline under their
  post (Teams "Posts" layout: scrolls a channel out of shape), (b) a single-column feed with a switcher
  (Slack simplified layout: one thing at a time, wrong for a dispatcher watching two channels), (c) the
  current tabs-and-cards.

## 4. Information architecture

```
/chat                                   fullBleed route; h-full flex row
├─ ChatRail            18rem            search · New (menu) · sections
│   ├─ Chats           direct + group, newest activity first
│   ├─ <Team> …        joined channels (General first), "Show N more channels" folded
│   └─ Muted           every conversation or channel muted "all", at the bottom
├─ stage               flex-1
│   ├─ ChatConversationStage  (?c=)     header · log · composer
│   └─ ChatChannelStage       (?ch=)    header · log of posts (each with its reply count) · composer
└─ ChatRepliesPane     24rem at xl      (?post=) the post, its replies, a reply field
```

- **URL:** `?c=<id>` a conversation, `?ch=<id>` a channel, `?ch=&post=` a thread. Unchanged, so every
  link in the bell, the compliance console and people's browsers keeps working. `?view=teams` is no
  longer written; a link that still carries it is read as "whatever `ch` says".
- **Phone (< lg):** the rail OR the stage, with a back chevron in the stage header (today's rule, D-DR25's
  pattern); a thread replaces the stage below `xl`, with Back to the channel.
- **Primary flow, before → after:** open a thread was Teams tab → channel → Reply (the conversation that
  was open is gone); it is now the channel row in the rail → the post's reply count → the panel opens
  beside it, and Esc or Close brings the channel back exactly as it was.

## 5. Decisions

- **D-CHATUI1 — `/chat` is a full-bleed route.** `meta.fullBleed: true`, as the live map: the shell gives
  the page `h-[calc(100dvh-4rem)]` and no gutters, the desktop sidebar starts collapsed (D-DR25), and
  `lint:ui-adoption` derives the `PageHeader` exemption from the same meta. The page title is the top
  bar's. The hand-kept `22rem/18rem` formula goes with it. Rejected: keeping the document shell and
  tuning the formula again — the third re-measurement in three weeks is the signal.
- **D-CHATUI2 — one rail, no tabs.** The Chats list and the Teams rail become sections of one list.
  Reason: a dispatcher is in both at once, and a list that drops the open conversation to show a
  channel fails the primary task. The sidebar badge already counted both (D-CHAT2).
- **D-CHATUI3 — rail order: Chats, then each team, then Muted.** Chats first because today (14 office
  members, 1 direct thread in production) that is where the traffic is; teams in the API's order;
  Muted last and folded by default, Teams' 2026 shape, so a muted item keeps its place and its count but
  never asks for attention. A team's acts (New channel, Add people for an owner, Leave team) live in a
  kebab on the team's section header, not on three buttons per team.
- **D-CHATUI4 — rows, not bubbles.** Every line is a row: a 28 px initial avatar (`AppAvatar sm`), the
  name, the short time (`h:mm AM`, the full stamp in `title`) on the first line of a run; a run is the
  same sender, the same day, within 5 minutes, and a failed send ends it. Continuation lines show the
  time in the gutter on hover and focus. Day dividers ("Today", "Yesterday", `MM/DD/YYYY` per D-DS18) carry
  the date, so no line repeats it. Own lines sit where everybody's do; "you" is a name, not a side.
  Reason: scanability and one row shape for a conversation, a channel and a thread (D-CHAT18 says a
  channel is a conversation; the rows should say so too).
- **D-CHATUI5 — unread is bold plus a small count, muted is neither.** Kept from CH2: the name bolds and
  the count sits in `bg-brand-accent-strong`; a conversation muted `all` keeps its count and never bolds.
  No red anywhere in the rail.
- **D-CHATUI6 — a "New" line marks where unread starts.** Taken from the conversation's `read_seq` the
  moment it opens, before `markRead` moves it; kept while that conversation stays open. Reason: the read
  boundary is the one fact the server already holds that answers "what have I not seen".
- **D-CHATUI7 — a row's acts appear on hover and focus, as icons.** Reply in thread (a channel post),
  Edit and Remove (own lines) as `AppIconButton sm` in a toolbar at the row's top right, shown on
  `group-hover` and `group-focus-within`, so a keyboard reaches them by tabbing into the row. A phone
  cannot hover; there the toolbar is always drawn on the row that has focus.
- **D-CHATUI8 — one field that grows.** The composer is one bordered field with the textarea growing from
  one line to eight, then scrolling, and the send button inside it at the right. Enter sends, Shift+Enter
  breaks, a composition in progress never sends (CH2). The counter appears only inside the last 10 % of
  `CHAT_BODY_MAX`. A placeholder that fits a phone: "Message Marcus Reyes", "Message # General".
- **D-CHATUI9 — a thread is a side panel.** 24 rem at `xl`, beside the channel; below `xl` it replaces the
  stage with Back. The panel is titled "Thread" with the channel under it; the post sits at the top
  with a hairline under it. Esc closes it.
- **D-CHATUI10 — the link state is the stage's, not the page's.** "Reconnecting…" is a one-line strip
  at the top of the log, `role="status"`, in the muted tint, shown only once a live channel has
  dropped (CH3b's rule). There is no page header to put it in any more.
- **D-CHATUI11 — the log is a live region.** The scroller is `role="log"`, `aria-live="polite"`,
  `aria-relevant="additions"`, `tabindex="0"`, labelled by the conversation's title; never assertive.
- **D-CHATUI12 — the measure is capped.** Rows and the composer sit in a `max-w-3xl` column (48 rem,
  ≈ 80 ch at 14 px) that is left-aligned in the stage; at `xl` with the thread open there is no slack
  to cap.
- **D-CHATUI13 — one density.** Comfortable only. A compact mode is one setting away (Q-CHATUI2) and
  the row component is written so that it is a class, not a second component.
- **D-CHATUI14 — the composer is bottom chrome.** It registers with `useBottomChrome`, so the Ask AI
  launcher keeps itself above it (`bottomChrome.ts`'s rule) rather than sitting on Send.
- **D-CHATUI16 — the keyboard is Slack's in the log and Linear's in the rail** (CR2, built 2026-10-26 on
  Q-CHATUI3's recommendation; the owner can still rule otherwise). On the page, where nothing is being
  typed and no modifier is held: `/` puts the caret in the rail's search, J and K open the next and the
  previous item in the rail's own order (Chats, each team's channels, Muted when unfolded), stopping at
  the ends. In the log: Up from an EMPTY composer lands on the newest line; Up and Down walk the rows
  (`data-chat-row`, roving `tabindex="-1"`) and stop at the top; Down past the newest line returns to the
  composer; Enter on a channel post opens its thread; E opens your own line for editing with the caret
  in the field, and Esc or Save hands focus back to the row. Esc in the thread panel closes it (kept);
  Esc marking a conversation read is NOT wanted — reading already moves on open. Rejected: a global
  "Up edits your last message" (Slack's) — it fires from an empty composer, which is exactly the key
  that now enters the log, and an edit by accident is worse than an edit two keys away.
- **D-CHATUI17 — a new line does not move a reader who has scrolled up.** `useChatScroll` stays the one
  owner of the scroll position: within 100 px of the bottom a line is followed as before; further up,
  somebody else's line is counted on a "N new messages ↓" pill at the bottom of the log (the noun is
  the log's: messages, posts, replies), and the pill, or reaching the bottom by hand, jumps and clears
  it. The reader's OWN line is followed wherever they are: they sent it, they want to see it land.
  Rejected: a second scroll owner for the pill — two watchers of one `scrollTop` is how lists jitter.
- **D-CHATUI18 — an empty workspace opens on the two ways to begin** (CR4). With both lists answered
  and both empty, the stage says "Nobody has started a conversation yet" with New conversation and, for
  a holder of Chat teams, New team — instead of asking somebody to pick from an empty rail. A team's
  empty General greets the team by name with what its maker wrote about it (the team's description,
  when there is one) in place of "No posts yet"; any other empty channel only says it is empty. The
  maker's NAME is not shown: `ChatTeam` in the rail's list carries no `created_by_name` (the team
  detail does), and a query for one line is not worth it.
- **D-CHATUI19 — own lines are not told apart** (Q-CHATUI1 ruled 2026-10-26). The name on the first line of a run
  already says "you"; the row keeps one shape across a conversation, a channel and a thread, and the two grounds
  it already uses (hover, the open post) would fight a third. If somebody misses it after a week on staging, it
  is one class on `ChatMessageRow`.
- **D-CHATUI20 — one density until a named person asks** (Q-CHATUI2 ruled 2026-10-26). The log already holds
  703 px of a 900 px window, about 16 lines; the office is 14 people on desks. A person setting is a migration,
  two merges, a Settings control and a second row class to keep in step with every CH6 addition. CR3 is built
  only when a specific person on a 13" screen asks, and then as the one class the row was written for.
- **D-CHATUI21 — no thread panel on direct or group conversations yet** (Q-CHATUI4 ruled 2026-10-26). D-CHAT19
  gives replies to channels only. A direct conversation with one other person has nothing to fork; the real
  case is a group such as Night dispatch, and that waits for CH6c, when reactions and pins arrive and the three
  together make a group behave like a small channel. Revisit with one measurement: how many group messages
  quote an earlier one.
- **D-CHATUI22 — a person has a colour, derived from their id** (owner, 2026-11-01: "design looks outdated
  and boring … proceed as proposed"). ⚠ This REVERSES §3's "nothing new is invented at the token level":
  eight `--identity-N` grounds with their own `--identity-N-ink`, muted, gated 4.5:1 in both schemes
  (`lint:ui-contrast`) and in sRGB (`lint:token-gamut`). `AppAvatar :identity` takes the user id;
  `identityTone` (FNV-1a + a final mix, `packages/ui/src/identity.ts`) picks the tone, so one person is
  one colour in the rail, the log, the picker, the mention list and the header. D-CHATUI19 stands: own
  lines are still not told apart by side or ground; your colour is the only thing that is yours.
- **D-CHATUI23 — the composer is a card with a toolbar, and New says what each choice makes.** The text
  on top; emoji tray, `@`, the key hint and Send along its foot (`ChatComposer`, `ChatEmojiTray`). Both
  tools only edit the draft. The rail's New is a quiet compose button (`KebabMenu :icon`, the secondary
  icon-button look) whose items carry a description (`KebabMenuItem`). The unread count wears the
  action pair (`ChatUnreadCount`), which D-CHATUI5's `brand-accent-strong` + `ink` failed to read as in
  dark. ⚠ No `+` attach: files are CH7 (Q-CHATUI5).
- **D-CHATUI24 — a group's or a channel's header shows its people.** `AppAvatarStack` — three faces and
  "+N", 28px with a 4px overlap (6px cut the initials, measured). A direct conversation's header wears
  the other person's colour.
- **D-CHATUI25 — the empty stage holds the button.** `ChatEmptyStage`: the brand chip, a heading, and New
  conversation, in place of one grey sentence pointing at a button elsewhere. New conversation's
  dialog opens on its search (`BaseModal :initial-focus`), not on its ×.
- **D-CHATUI15 — tests move with the structure.** `ChatPage.test` loses the tab cases and gains the rail
  ones; `ChatConversationPane.test` loses "own lines on the right" and gains runs and dividers;
  `ChatTeamsView.test` becomes `ChatChannelStage.test`; `chatGrouping.test` pins the run and day rules
  with a mutation check. A browser pass (1440 and 390, data / empty / fail) before the PR.

## 6. Work queue

| Item | What | Depends on |
|---|---|---|
| CR1 | The workspace: full-bleed route, `ChatRail` (sections, search, New, team kebab, Muted), `ChatStageHeader`, `ChatMessageList` + `ChatMessageRow` + `ChatPendingRow` + `chatGrouping.ts`, the composer, `ChatConversationStage`, `ChatChannelStage` + `ChatRepliesPane` as a panel, phone layout, tests, browser pass | — |
| CR2 | **DONE 2026-10-26.** Keyboard: `/` focuses search, Esc closes the thread, Up from an empty composer into the log, J/K in the rail (D-CHATUI16); "Jump to latest" when scrolled away and new lines arrive (D-CHATUI17) | CR1 |
| CR3 | Compact density as a setting (`chat_person_state`, D-CHAT24's "a person's own state") | CR1, Q-CHATUI2 |
| CR4 | **DONE 2026-10-26.** Empty workspace: a first-run stage ("Nobody has started a conversation yet" with the two acts) and a team's empty General with a welcome line from its maker (D-CHATUI18) | CR1 |

CH6b–d (mentions, Activity, reactions, pins, saved, mute, browser notifications) land on CR1's rows:
a reaction strip is a row footer, Activity is a rail section above Chats, mute is a kebab item.

## 7. States

Rail: loading (`QueryState compact`), failed, empty ("No conversations yet. Start one with New."),
searching with no match, a team with every channel joined (no "Show more"), a team with none joined.
Stage: none chosen ("Pick a conversation, or start a new one."), loading, failed, a channel you are not
in (Join), a channel you cannot see, empty log ("No messages yet. Say hello."), earlier page loading /
failed (CH6a), new-messages line, pending line, failed line with Retry, edited, removed, Seen,
reconnecting. Composer: empty (Send disabled), over the limit (counter in `danger`), a removed post
("This post was removed, so it takes no new replies."). Thread: loading, failed, no replies yet, the post
not on this page (page back, CH6a).

## 8. Open questions

| Q | Question | Candidates and recommendation |
|---|---|---|
| Q-CHATUI1 | Should own lines be told apart at all, now they sit on the left? | **RULED (a) 2026-10-26 → D-CHATUI19.** (a) **No**: the name says "you" by being yours, as in every work chat reviewed. (b) A faint `surface-subtle` ground behind own rows. (b) stays one class if anyone misses it after a week on staging |
| Q-CHATUI2 | Compact density — when? | **RULED 2026-10-26 → D-CHATUI20: not now, and not as a setting until a named person on a 13" screen asks.** (a) After CR1, as a person's setting (CR3). (b) Never. CR3 stays in the queue behind that ask |
| Q-CHATUI3 | Keyboard model — Slack's (Esc marks read, Up into the log) or Linear's (J/K, U)? | **RULED 2026-10-26: D-CHATUI16 ratified as built in CR2** — Slack's for the log, Linear's J/K for the rail, no Esc-marks-read |
| Q-CHATUI4 | Should the thread panel also show on direct and group conversations (Google Chat's 2025 inline threading in DMs)? | **RULED 2026-10-26 → D-CHATUI21: not now.** D-CHAT19 gives replies to channels only; a direct conversation has nothing to fork, and the group case waits for CH6c, measured first |
| Q-CHATUI5 | The composer's `+` — what does it hold? | **OPEN.** (a) Files only, when CH7 builds storage, contract and ledger action — **recommended**: a `+` that opens a menu of nothing is a workaround drawn as a feature. (b) "Share a load / truck / driver" as a linked card — needs a record picker and a body token the server validates (a contract change, like `<@id>`); worth it, but its own item after CH7 |
| Q-CHATUI6 | Should "L-20481" or "Truck 702" in a line become a link to the record? | **OPEN.** The web cannot resolve a load number or a unit number to a record id without an API read per line; a chip that only filtered a list by the typed text would be a copy of the search box. (a) A server-side resolver that returns `{ text, kind, id }` spans with the line, org-scoped — **recommended**, one reader, no client guessing. (b) Leave it until (a) is planned |
| Q-CHATUI7 | Search in a conversation, pinned and reactions in the header? | **Waits, not open:** search is CH8, pins and reactions are CH6c-2. The header's right side has room for both |

## 9. Progress log

- 2026-10-26: audit (17/30, REDESIGN), research, this plan. **CR1 built** on `claude/office-chat-redesign`: measured after, 1440×900 with a conversation open, the log is **703 px of 900** (was 302), the rail 288 px, the composer 76 px (was 165); the thread opens beside the channel at `xl`; 1440 and 390 passed on data, empty and failed fixtures in both schemes; 87 chat tests, four grouping mutants (window, day, failed send, New) each fail one test.
- 2026-10-26: **CR2 and CR4 built** on `claude/office-chat-cr2` (D-CHATUI16–18). Seen in the built page on
  the fixtures (`tools/chat-fixtures/`, now committed, with `__line` to deliver somebody else's line and
  `clear` to empty a thread): `/`, J, K, Up from the empty composer, the arrows along the log, E then
  Esc, Enter on a post, the "2 new messages ↓" pill holding the reader at the top and jumping on a
  click, "Welcome to Dispatch" with its description in an empty General, the first-run stage opening the
  New conversation dialog; 1440 and 390, light and dark. 103 chat tests (was 87); eight mutants — own
  line not followed, no near-bottom rule, no clear on reaching the bottom, Down past the newest doing
  nothing, E on anybody's line, J wrapping, shortcuts firing while typing, General greeting nobody —
  each fail a test. Full web suite 4,133 green. Remaining: CR3 behind Q-CHATUI2; Q-CHATUI1, Q-CHATUI4.
- 2026-10-26: **CR2 + CR4 MERGED** (#1765, main 5be26f5). **Q-CHATUI1–4 ruled** by the owner as recommended:
  D-CHATUI16 ratified, D-CHATUI19 (own lines not told apart), D-CHATUI20 (one density until a named person
  asks; CR3 waits on that), D-CHATUI21 (no threads in direct or group conversations before CH6c). No open
  questions remain in this plan; the queue is CR3, held.
- 2026-11-01: The owner's screenshot of New conversation showed each tick box 8px above its name — fixed in
  #1881 (merged 08762f1): the picker's row is one `role="checkbox"` button with a drawn box, picked people
  show as chips. Then "outdated and boring" → proposal V1–V6 → owner: "proceed as proposed". Built
  D-CHATUI22–25 on `claude/chat-modern-look`. Deferred with reasons: V3 entity links (Q-CHATUI6), the `+`
  (Q-CHATUI5), header search and pins (Q-CHATUI7), message-arrival motion (the log's scroll rules,
  D-CHATUI17, would have to learn which rows are new — not worth it for a fade). Found on the way: the
  identity hash first read only the low three bits of each character (a mutant survived); fixed with a
  final mix. Seen in the built page against the fixtures, light and dark, 1440 wide.
