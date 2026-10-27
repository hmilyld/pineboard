# 07 Visual and Typography Spec (Pineboard · finalized 2026-10)

English | [简体中文](zh-CN/07-design-spec.md)

> **Status: final, the sole visual source of truth.** This document replaces the original "Pineboard / Workbench v1.1" visual section in `docs/05-frontend-theming-ops.md`. The old implementation's serif large headings, `#F0F1EB` paper background, and 1180 workbench masthead are no longer used.
>
> Page-by-page confirmation is complete; **the implementation phase no longer reopens color, font size, column width, or page structure**. If an implementation conflict with this document appears, change this document first, then change the code.
>
> - Upstream does not ship personal site screenshots; regenerate Pineboard screenshots per this document after running.
> - Data and API: `docs/02-data-api-config.md` is the baseline; section 10 of this document lists the increments
> - Auth/permissions/email: `docs/03-auth-permissions-email.md`
> - Before starting: the 5 spikes in `docs/06-roadmap-risks.md`, especially Better Auth + D1 transactions

---

## 1. Design goals

"Pineboard" is a forum centered on **topics and replies**, not a content site and not a SaaS dashboard. The visual metaphor is a **shared workbench + field manual**: high information density, aligned columns, scannable numbers, and boundaries drawn with 1px hairlines instead of card shadows.

Three hard principles:

1. **Forum feel comes from structure**: fixed columns (title / replies / views / last reply), avatars, floor numbers, last replier, page numbers, category color dots. Do not manufacture "premium feel" with big headings, whitespace, or rounded cards.
2. **See content in one screen**: within 900px of desktop height, the homepage shows at least 8 topics; the topic page's first screen shows at least the first post body and one reply.
3. **Each color does one job**: pine green = structure and actions; orange = current state and primary action; amber = digest, announcements, notices. Destructive actions use orange text only, never a solid red block.

---

## 2. Finalized pages

| Page | Path | Finalization points |
|---|---|---|
| Home | `/` | Dark pine header 56, announcement 36, 52px list rows, 176 right rail; category entry in the header dropdown and the right rail (pill bar removed 2026-10-25) |
| Topic page | `/t/:id` | 140px author column, 14px body, always-visible action row, threaded replies, page numbers top and bottom, 20 posts/page, OP only |
| Category page | `/c/:slug` | Compact header, four filters, 176 right rail, bottom page numbers, 20 topics/page |
| Login | `/login` | Brand left, form right, manifesto + three numbers; standalone shell, no site-wide header |
| Register | `/register` | Same shell, nickname + username, Turnstile |
| Profile center | `/me` | 188 left navigation (content/settings), full profile header, four numbers |
| Public profile | `/u/:username` | Reuses the profile center shell, hides settings and private items |
| New topic | `/new` | 1180 full-width single column, category pills, write/preview, tag chips, publish at bottom right |
| Search | `/search` | Post-level results, title + snippet + meta, amber highlight, two sort orders |
| Tags overview | `/tags` | Two columns, with recent topics, search box |
| Tag detail | `/tag/:slug` | Compact header with three numbers, three sort orders, bottom page numbers |
| Notifications | `/notifications` | Today/yesterday/earlier, merged by topic, unread color bar, numbered pagination 30/page |
| Error pages | 403 / 404 / 500 | One shared set, minimal and centered, full header, contact administrator |
| Admin | `/admin` | 188 dark sidebar on desktop; top bar + menu button on mobile/tablet, navigation collapsed by default |

See section 13 for the reference image mapping.

---

## 3. Design tokens

### 3.1 Color

| Semantics | CSS variable | Light | Dark |
|---|---|---|---|
| Page background | `--page` | `#F1F3F1` | `#0E1411` |
| Surface / panel | `--surface` | `#FFFFFF` | `#151D18` |
| Ink / primary text | `--ink` | `#141C19` | `#E7ECE7` |
| Secondary text | `--muted` | `#5F6B66` | `#96A29B` |
| Hairline | `--line` | `#DDE3DF` | `#27332C` |
| Hover background | `--hover` | `#F6F9F7` | `#1B261F` |
| Pine green / structure and actions | `--pine` | `#14513F` | `#6FBFA3` |
| Text on pine | `--on-pine` | `#F4F8F4` | `#08120D` |
| Orange / state and primary action | `--orange` | `#E2542C` | `#F0703F` |
| Amber / digest and notices | `--amber` | `#B4791A` | `#E0B25A` |
| Header background | `--head` | `#14513F` | `#0B2B22` |
| Announcement background / line | `--notice` / `--notice-line` | `#FBF6EA` / `#E8D9B8` | `#1C1910` / `#3B331E` |
| Admin sidebar | `--admin-side` | `#0F4032` | `#0B2B22` |

Mapped to the existing shadcn / Tailwind tokens (`apps/web/src/styles.css`):

| Existing variable | New value |
|---|---|
| `--background` | `var(--page)` |
| `--foreground` | `var(--ink)` |
| `--card` / `--popover` | `var(--surface)` |
| `--muted-foreground` | `var(--muted)` |
| `--border` / `--input` | `var(--line)` |
| `--primary` | `var(--pine)` |
| `--primary-foreground` | `var(--on-pine)` |
| `--brand` | `var(--orange)` |
| `--brand-foreground` | `#FFFFFF` (dark `#1A0E0A`) |
| `--signal` | `var(--amber)` |
| `--destructive` | `var(--orange)`; only for text and strokes, never a solid fill |
| `--ring` | `var(--pine)` |

Derived colors always use `color-mix(in srgb, ...)`; do not add scattered hex values:

```css
--pine-soft: color-mix(in srgb, var(--pine) 4%, var(--surface));
--pine-line: color-mix(in srgb, var(--pine) 35%, transparent);
--orange-soft: color-mix(in srgb, var(--orange) 8%, transparent);
--amber-soft: color-mix(in srgb, var(--amber) 8%, transparent);
--amber-mark: color-mix(in srgb, var(--amber) 26%, transparent);
```

### 3.2 Category colors

| Category | Light | Dark |
|---|---|---|
| Tools & Productivity | `#14513F` | `#6FBFA3` |
| General Discussion | `#3C5A8A` | `#7E9BD0` |
| Game Guides | `#B4791A` | `#E0B25A` |
| Development & Tinkering | `#C0472B` | `#E27C5C` |
| Chit-chat | `#6B4C7A` | `#A98BB8` |

- Category color is used only for the **6px dot, 3px list left bar, category name text**; never as a large background area.
- When there is no category color, fall back to `--muted`; do not use random colors.
- Tags do not use category colors; they are uniformly neutral outlined pills; when color is needed use `tags.color`, but it must not override readability.

### 3.3 Typeface

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
  "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
```

- **Sans-serif site-wide**. Serif is used only for the brand "工" mark (24×24, 13px / 700).
- All numbers use `font-variant-numeric: tabular-nums`, for reply counts, view counts, floors, stats, and page numbers.
- Do not introduce web fonts; use system fonts to avoid FOUT and extra requests.

### 3.4 Font sizes

| Level | Size / line height / weight | Notes |
|---|---|---|
| Site name | 17 / 1.2 / 700 | Header |
| Topic page title | 21 / 1.35 / 700, `-0.015em` | `h1` |
| Page title | 20 / 1.3 / 700, `-0.02em` | Category, tag, notifications, new topic, admin |
| List title | 14.5 / 1.45 / 600, `-0.01em` | Home, category, tag, profile center |
| Search result title | 15 / 1.45 / 600 | May wrap to two lines |
| Post body | 14 / 1.8 | Max 64ch |
| Threaded reply body | 13.5 / 1.75 | |
| Form input | 13 / 1.4 | 14 on mobile |
| Meta | 11.5 | Author, time, category |
| Small text | 10.5 | Last reply time, stat labels |
| Micro text | 9.5 | Badges, roles, notices |
| Sidebar numbers | 19 / 600 | Home site numbers |
| Admin numbers | 21 / 600 | Overview four-cell grid |
| Error code | 56 / 1 / 700, `-0.045em` | 404 |

No more than 4 font-size jumps; do not use 4rem headings.

---

## 4. Spacing, widths, shapes

- Base 4px. Block spacing 12 / 14 / 16 / 18 / 20; page main area top and bottom 14–20.
- List rows 52px; notification rows about 76px; post height determined by content.
- Corner radius: buttons/inputs **3px**; search box **4px**; panels **6px**; pills **999px**. Never more than 6px.
- Inputs/selects and buttons on the same row are uniformly **38px** tall (`.v2-inline-controls`); compact icon buttons inside table rows stay 26px.
- Shadows: **none by default**. Only the PWA update prompt and dialogs may use `0 12px 32px rgba(0,0,0,.18)`.

| Page | Content width |
|---|---|
| Home / category / tag page / tag list / search | 1180 (main column + 176 right rail + 18 gap) |
| Topic detail / new topic / edit / revision history | 1180 full width, no right rail |
| Notifications | 1180 (inside AccountShell) |
| Profile center / public profile | 1180 (188 navigation + 20 gap + content) |
| Login / register | 1180 two columns (1.02fr / 1fr) |
| Admin | Full width; 188 sidebar + content |

Page horizontal padding: 16–18px desktop, 10–12px mobile. Content containers are centered; do not use percentage widths for body text.

---

## 5. Global frame

### 5.1 Header

- Height **56px** (mobile **50px**), dark pine `--head` full-bleed, content max 1180px centered, 18px left and right.
- Left: 24×24 off-white square "工" (serif 13/700, pine text), 9px gap, site name 17/700.
- Middle: Home, Categories, Tags, 13px, 16px gap; current item white + 2px orange underline (`inset 0 -2px`).
- Search: 160×30, 8% translucent white fill, 1px white 16%, 4px radius, magnifier + 11.5px placeholder. **The `/search` page hides the header search box** so two entry points never share a screen.
- Right when logged out: Login (text) + Register (orange fill, white text, 3px radius, 5×11 padding).
- Right when logged in: New topic (orange fill), notification bell (orange dot or orange number when unread), 26px round avatar. Admin/moderator may get one extra "Admin/Review" entry, but it must not squeeze the search box.
- Mobile: site name on the left; search box in the middle (filling remaining width); notifications, avatar, menu on the right. Navigation folds into a drawer. The drawer is a full-screen right panel, background `--head`, links 15px, admin entry at the bottom. The search box and right-side buttons must stay on the same line and must not overflow horizontally.
- Header `position: sticky; top: 0; z-index: 30`; stays opaque when scrolling, no shadow.
- **No language switcher.** The interface language is a single site-wide setting (`site.language`), chosen by the operator in the admin panel; the header carries no locale control and the drawer has no locale section. Do not reintroduce a per-visitor switcher.

### 5.2 Homepage category entry (adjusted 2026-10-25)

- The homepage no longer renders the `#categories` category pill bar, to avoid duplicating height with the top navigation.
- Category entries remain in two places: the header "Categories" hover dropdown (arrow + auto-collapse on blur) and the "Categories" module in the homepage right rail.
- There is no category horizontal scroller on mobile; the category list folds into the "Categories" group of the right drawer.
- The new-topic entry stays in the header/drawer and does not depend on the category bar.

### 5.3 Announcement bar

- Height **36px** (mobile 34), `--notice` background, 1px `--notice-line` bottom border.
- Left 3×14 orange vertical bar + 10.5/600 "Announcement" + 11.5px body, single line with ellipsis.
- Right close ×; dismissed state is written to `localStorage`, key `announcement.dismissed.<announcement.id>`.
- Takes no height when there is no announcement or it is dismissed. Announcement content comes from `site.announcement` (see 10.2); do not hardcode it.

### 5.4 Footer

- Height **54px**, white background, 1px `--line` top border; content max 1180, 18px left and right.
- Left: 16×16 pine square "工" + 12/600 site name + 10.5 tagline; right: navigation (Home · Categories · Tags · Search) + © year.
- Mobile keeps the footer: brand + one-line description on the first line, navigation links and copyright on the second line; do not simply `display:none`.

---

## 6. Shared components

### 6.1 Topic list row

All topic lists share one row (except home, category, tag, profile center, public profile, and search results).

```
┌ 3px category color bar ──────────────────────────────────────┐
│ Title (pinned/digest badge + 14.5/600)   Replies  Views  Last │
│ Mobile: title two lines + category · time · N replies        │
└──────────────────────────────────────────────────────────────┘
```

- Row height **52px**, 1px `--line` top and bottom; the last row also has a bottom line; 3px category color bar on the left.
- Desktop columns: `minmax(0,1fr) 32px 46px 68px`, gap 6, numbers right-aligned.
- Title single line with ellipsis; on hover turns pine green + underline (1px, offset 3px).
- Badges: pinned orange stroke/8% fill; digest amber stroke/8% fill; 9.5px, radius 2, line height 1.6. Badge text is mandatory; color alone is not enough.
- Reply count 12.5/600 ink; view count 11.5 `--muted`; last reply 68px right-aligned, first line 11/500 name, second line 10.5 relative time; when nobody has replied show "—" + time.
- Mobile (<600): hide the table header and the replies/views/last-reply columns; row height becomes adaptive (about 60), title at most two lines, with 10.5px "category · time · N replies" below.
- No excerpt; no avatars in the list (category dot + title take priority).

### 6.2 Pagination

- Traditional page numbers, no "load more"; on list pages at the bottom only, on topic pages both top and bottom.
- Page number: minimum 24×22, 11px, tabular-nums; current page solid pine with `--on-pine`; hover shows a 1px border; disabled arrows 35% opacity.
- More than 7 pages: `1 … 4 5 [6] 7 8 … 20`; first and last + 2 on each side of the current page.
- Topic page top bar height 36, background 3% pine tint, left "Page x of y · N posts", right page numbers; bottom bar height 40, centered page numbers + "N posts total".
- List page bottom bar height 46, centered page numbers; the right side may show "N topics total".
- Page changes write the URL query `?page=`; browser back/forward works; scroll to the top of the list (on topic pages scroll to the top post).
- 20 items/page (topic pages 20 posts/page, list pages 20 topics/page), from `seo.postsPerPage` / `seo.topicsPerPage`; do not hardcode in the frontend, but the UI defaults to 20.

### 6.3 Tabs / filters / buttons

- Filter tabs: 12.5px, active ink 600 + 2px pine underline; height 38–40; not pills.
- Tag chips: height 26, radius 999, 1px `--line`, 11.5px; selected has 8% pine fill + pine stroke; at most 5, beyond that disable the unselected options.
- Primary button: solid pine, `--on-pine`, height 36–40, radius 3, 12.5/600; hover 90% pine.
- Secondary button: transparent fill + 1px `--line`, height 26–34, 11.5px.
- Text button: 11.5px `--muted`, hover ink; destructive actions use orange text, no red fill.
- Input: height 38 (mobile 42), 1px `--line`, radius 3, 13px; focus pine border + 2px pine 18% outer ring; placeholder `--muted` 60%.

### 6.4 Editor

- Container white background, 1px `--line`, radius 6.
- Title input: height 58, 19/600 (mobile 17), counter 15/120 on the right, 10.5 `--muted`.
- Tab bar: height 34, "Write / Preview" tabs + divider + toolbar icons; active tab 2px pine underline.
- Body: 14/1.85, padding 12×16; new topic page height 252 (mobile 236), reply box height 88.
- Bottom: word count / Markdown hint + preview + publish (pine 36); on the new topic page publish is at the bottom right, cancel on the left.
- Tag selection sits below the body: 26px chips, "2 / 5" counter on the right.
- Draft: `localStorage`, key `draft:new-topic`, saved 800ms after typing stops; on restore show "Draft restored" and offer clearing. Do not add a server endpoint for drafts.
- Validation: field-level errors directly below the field (11px orange), plus one summary line at the bottom; while submitting disable the button and show "Publishing…".

### 6.5 Empty, loading, error

- Empty state: 1px lines top and bottom, 40–56px vertical, centered 12.5px `--muted`; may carry one primary action (e.g. "Go post the first topic").
- Loading: 3–4 skeleton rows, same height as real rows, to avoid jumping; no full-screen spinner.
- Request error: inline 1px orange stroke + 8% orange fill, 12px, with a "Retry" text button; no alert.
- Form error: same as 6.4; network errors preserve user input.

---

## 7. Per-page specs

### 7.1 Home `/`

```
Header 56
Announcement 36 (optional)
┌ Main column 1fr ───────────────────────────┐ ┌ Right rail 176 ┐
│ Latest reply  Latest  Hot      N topics    │ │ Site           │
│ Topic                Replies Views  Last   │ │ 2×2 numbers    │
│ ▍Pinned  Title…         2  1286  Linshen   │ │ Categories     │
│ ▍Digest  Title…         2   932  Beian     │ │ dot + latest   │
│ …                                          │ │ Popular tags   │
└────────────────────────────────────────────┘ └────────────────┘
Footer 54
```

- Content 1180; 18px between main column and right rail; main area 16 top, 22 bottom, 16 left and right.
- Main column white background, 1px line, radius 6; toolbar height 40 (sort tabs + count on the right); table header 28; rows 52; topics per page controlled by `seo.topicsPerPage` (default 20, 5–50), page numbers at the bottom.
- Sorting: Latest reply / Latest / Hot; default Latest reply. Only the sort changes, no page jump.
- Right rail module order: **Site** (today's posts / topics / replies / members, 2×2, 19px numbers, grid lines) → **Categories** (color dot + name + topic count, latest topic title on the next line, 10px ellipsis) → **Popular tags** (at most 12, 10.5px pills).
- Right rail **176px**, no panel border; 18px between modules; module titles 10.5/600 `--muted`, letter-spacing 0.05em.
- Mobile: the right rail drops below the list, and the three modules collapse into one expandable "Site info" bar (44px), collapsed by default; row height about 60; about 10px content padding.
- The homepage does not show "online users". No excerpts, no category column.

### 7.2 Topic page `/t/:id`

- Content 1180 full width, no right rail.
- Top breadcrumb 11.5: Home / category dot + category name.
- Title area: `h1` 21/1.35/700; meta below at 11.5: author · relative time · N replies · N views; tag chips on their own line.
- Right actions: OP only toggle (24×14 track), bookmark (26 height, outlined), more "…"; edit, history, report are shown only to the author/moderator (placed in the post action row, not repeated in the title area).
- Post pagination: top 36 tinted bar + bottom 40 bar; posts per page controlled by `seo.postsPerPage` (default 20, 5–50); `?page=`; the first post is always on page 1.
- Post: `grid-template-columns: 140px minmax(0,1fr)`; 1px line on the right of the author column.
  - Author column: 36 avatar (radius 3, pine fill with off-white text), 12.5/600 name, role badge 9px, 10.5 time, floor number `#N` 10.5.
  - Body: 14/1.8, filling the content column width (no longer limited to 64ch); paragraph spacing 16; blockquote 2px pine left border + `--muted`; code block `--page` background, 1px line.
  - Action row: **always visible at the bottom left** "Quote · Reply · Like N", not revealed on hover; right side "Edit · History · Report" 10.5.
  - Edited: append "· edited" after the time, hover shows the edit count.
- Threaded replies: **same width as the main post**, `grid-template-columns: 140px minmax(0,1fr)`; 4% pine background + 3px pine left border; the author column is the same width as the main post, usernames may wrap and are not truncated; body 13.5/1.75; at most two levels, child posts do not show a "Reply" button.
- "Quote" = insert a quote block at the top of the body and add a normal post; "Reply" = append below the replied-to post (`parentPostId`); do not mix the two.
- Bottom editor: persistent at the end of the topic, expanded by default (not floating over content); heading "Reply to topic" 38 high; toolbar 32; textarea 88; bottom "Please don't post ads…" + preview + post reply (pine 28). On mobile the button is full width.
- Locked topic: the editor is replaced by a 1px line notice "This topic is locked and no longer accepts new replies"; hide the submit button.
- Anchors: each post has `id="post-<floor>"`; notification/quote jumps go to `#post-<floor>` and highlight for 2 seconds (6% pine background).
- OP only: toggles `?onlyOp=1`, resets to page 1; the first post is always shown; the toggle state is written to the URL so it can be shared.
- Deleted/hidden post: keep a placeholder "This post was deleted" 10.5 `--muted`, do not show the body; moderators can expand the original text.

### 7.3 Category page `/c/:slug`

- Content 1180, main column + **176 right rail**, gap 18.
- Compact header: breadcrumb 11.5; `h1` 20/1.3/700; description 11.5; three numbers on the right (topics / today / replies, 15px) + orange "＋ New topic"; 1px line below.
- Filter bar height 40: **Latest reply / Latest / Hot / Digest**; default Latest reply; active 2px pine underline; "N topics total" on the right.
- The list uses the same 52px rows and four columns as the homepage.
- Right rail: **Categories** (current category highlighted, other categories with color dot + name + topic count + latest topic) → **Site** (2×2 numbers). The order differs from the homepage; categories come first.
- Bottom page numbers 46; 20 topics/page.
- Mobile: the right rail folds below the list; the filter bar scrolls horizontally; rows become two lines; page numbers are kept.
- The "Digest" filter corresponds to `isDigest=1` (see 10.2); when there is no digest show the empty state "This category has no digest topics yet".

### 7.4 Login `/login` and register `/register`

- **Standalone shell**: does not render the site-wide header/footer; route `meta.bare = true`. Page max 1180, two columns `1.02fr 1fr`, min height 540; outer background `--page`, panel radius 8.
- Left brand column: pine `--head`, padding 28×30; top 26 square "工" + 16/700 site name + 10.5 tagline; middle manifesto 24/1.5/600 "Bring your questions here, leave the methods behind." + 11/1.85 description; bottom three numbers (topics / members / today, 17/600) + 9 runtime environment.
- Right form column: white background, padding 20×28; "← Back to home" 10.5 at top right; form max 300 centered.
  - Login: `h1` 22 "Log in"; subtitle 11.5 "Use your email and password to enter the forum."; email, password (with "Show"); right-aligned "Forgot password" 10.5; submit 40 pine; bottom "Don't have an account yet? Create one".
  - Register: `h1` 22 "Create account"; subtitle 11.5 "You can log in right after registering; you must verify your email before posting."; nickname, username (3–20 lowercase letters/digits/_/-, cannot be changed after registration), email, password (at least 10 characters), confirm password; Turnstile silent by default (shown only when confirmation is required); submit 40; bottom "Already have an account? Log in".
  - Field labels 11/500 `--muted`, 11px gap; errors 11 orange; on Turnstile failure you must call `reset()`.
- Mobile (<600): hide the left brand column, the right column fills the width; show 22px "工" + 16 site name at the top; form padding 16×18; input 42, submit 44.
- The three numbers come from `/api/site/stats`; verification/reset/forgot password reuse the same shell (see section 12).
- After successful registration do not log in automatically (per `docs/03`); redirect to the verify-email notice page; after login return to `redirect`, default `/`.

### 7.5 Profile center `/me` and public profile `/u/:username`

- Content 1180; `grid-template-columns: 188px minmax(0,1fr)`, gap 20; breadcrumb at the top.
- Left navigation (188, sticky top 72):
  - "Content": My topics 12, My replies 48, My bookmarks 6 (10.5 numbers on the right).
  - "Settings": Notifications 3, Email preferences, Account and data.
  - "Log out" at the bottom.
  - Item height 32, 2px transparent left border; active gets 2px pine left border + 4% pine fill + ink; hover `--hover`.
- Email unverified: 34-high notice bar, 3px amber left bar + 8% amber fill, 11px; "Resend" orange text on the right.
- Profile header: white background, 1px line, radius 6, padding 16; 54 avatar (radius 4, pine fill); name 19/700 + role badge; `@username · joined YYYY-MM-DD` 11; bio 11.5; "Edit profile" + "…" on the right.
- Four numbers: topics / replies / likes received / bookmarks, 16/600 + 10.5 labels, four equal columns, 1px line above.
- Content section heading row: `h2` 13/600 "My topics" + "12 total" 10.5 + "＋ New topic" 26-high pine on the right.
- The list reuses 52px rows; the profile center does not show a category column but keeps the 3px color bar; page numbers at the bottom.
- `/u/:username`: same shell, hides the "Settings" group, log out, and edit profile; keeps the public content tabs (topics / replies / bookmarks? bookmarks are not public, replace with "Likes received" or hide). The public page shows only topics, replies, and likes received; bookmark counts are not public.
- Mobile (<900): the left navigation becomes horizontal tabs (height 30, 2px active line at the bottom, horizontal scroll); the profile header is kept, action buttons hidden; the four numbers become 2×2; list rows two lines.
- Empty states: My topics "You haven't posted any topics yet" + "Go post the first topic"; Bookmarks "No bookmarks yet".

### 7.6 New topic `/new`

- Content **1180** full width; page padding 16; the top breadcrumb may be omitted.
- Title row: `h1` 20 "Post a topic"; 10.5 "Draft autosaved · HH:MM" on the right.
- Category selection: one row above the title, 10.5 "Post to" on the left, category pills on the right (28 high, 6px color dot, selected has 8% pine fill + pine stroke); horizontal scroll on mobile.
- Editor panel: white background, 1px line, radius 6; toolbar includes image/attachment upload (controlled by the admin `feature.uploads`).
  - Title input 58 high, 19/600; 15/120 on the right.
  - Tab bar 34: "Write / Preview" + toolbar (B / I / Quote / Code / Link / Image / Compressed attachment); "Markdown" 10.5 on the right.
  - Body 252 high, 14/1.85, padding 12×16.
  - Word count + "Ctrl + Enter to publish" 10.5.
  - Tag area: 10.5 "Tags, up to 5" + "2 / 5" on the right; chips 26, at most 5.
  - Turnstile: 300×60 (full width on mobile), 10.5 explanation on the left "One human verification is required before publishing, to keep bots from spamming."
  - Bottom: 10 on the left "You can still edit after publishing; whether editing is allowed after replies depends on site rules."; "Cancel" + "Post topic" 36 pine on the right.
- Email unverified: replace the whole page with a notice card (do not show the editor): amber left bar + heading "Verify your email before posting" + description + "Resend verification email" + "Back to home"; after sending, show a countdown.
- Validation: title empty/over 120, body empty/over 32KB, no category selected, more than 5 tags, Turnstile not completed; below the field + a summary at the bottom; on failure `reset()` Turnstile.
- Mobile: single full-width column; title 17; body 236; toolbar scrolls horizontally; publish button full width; Turnstile full width.
- Draft: on entering the page read `draft:new-topic`; if it has content, offer to restore; clear on successful publish; switching category does not clear it.

### 7.7 Search `/search`

- Content **1180**; main column + **176 right rail**; breadcrumb at the top; no page `h1`, the search box is the title.
- Search bar: height 44, white background, 1px line, radius 4; magnifier on the left; input 14; clear × when it has content; pine "Search" button on the right (about 72 wide, full height).
- Result header: 11.5 "N results found"; sorting on the right "Relevance / Latest", active pine 600; only these two orders.
- Result list: white background, 1px line, radius 6; each item 12×14 padding, 1px separators.
  - Title 15/600 single line with ellipsis; matched term `<mark>` with 26% amber background, radius 1.
  - Snippet 12.5/1.7 `--muted`, at most 2 lines, with ellipses around it; highlighted the same way.
  - Meta 10.5: category dot + category name · author · `#floor` · relative time.
  - Multiple matching posts in the same topic are shown separately (post-level results); titles may repeat; do not merge.
- Bottom page numbers 46; 20 items/page.
- Empty state: centered "No results for "q"" 15/600 + 11.5 description; popular tag chips; 1px separator; "Latest topics" 3 items (category dot + title + time), clicking enters the topic.
- The header's small search box is hidden on `/search`; kept on other pages.
- When the query is empty show the empty state + popular tags and do not request an empty query.
- Mobile: search bar 42; result titles may wrap to two lines; snippets 2 lines; meta wraps; page numbers kept.

### 7.8 Tags overview `/tags`

- Content **1180** main column + **176 right rail**; `h1` 20 "Tags" + 11.5 description "Use tags to find related topics. Tags are not categories; they are more like marks on a topic."; search box 220×32 on the right (full width on mobile, placed below the title).
- Two-column grid, 1px separators; each item padding 12×14:
  - First line: `#` + tag name 15/600 (`#` pine); "23 topics" 10.5 on the right.
  - Second line: latest topic title 10.5, indented 11, single line with ellipsis; "No topics yet" when there is none.
- Sorted by usage descending; search filters on the frontend (`name/slug` contains), or backend `?q=`; frontend filtering is fine for up to 200 in the first version.
- Mobile: single column; search box 36 high; each item 11×12.
- No page numbers at the bottom (the overview shows everything at once; paginate only beyond 200).

### 7.9 Tag detail `/tag/:slug`

- Content **1180** main column + **176 right rail**; breadcrumb "Home / Tags / Hands-on".
- Compact header: `h1` 20, `#` pine; description 11.5; three numbers on the right: **23 topics / 2 today / 128 replies** (15/600).
- List bar height 40: **Latest / Latest reply / Hot** (three sorts, not four); default Latest; "23 topics total" on the right.
- The list uses the same 52px rows and four columns as the homepage; bottom page numbers 46; 20 topics/page.
- Mobile: header numbers wrap below the title; sorting scrolls horizontally; rows two lines.
- Tag missing: 404 copy "This tag has no topics yet" + go to tags overview.

### 7.10 Notifications `/notifications`

- Content **1180**; `h1` 20 "Notifications" + 11.5 "Someone replied, mentioned you, or handled your report."; "Unread only" toggle (26 high, outlined) + "Mark all as read" text on the right.
- Group headings: Today / Yesterday / Earlier, 10.5 `--muted` + 1px line on the right; 14 between groups.
- Notification row: `grid-template-columns: 32px minmax(0,1fr)`, gap 10, padding 11×14; 1px separator; min height about 76.
  - Unread: 3px pine bar on the left + 4.5% pine fill; read is transparent.
  - Avatar 32, radius 3; system notifications use an amber square "工" or icon.
  - First line 11 `--muted`: actor + action (replied to your topic / mentioned you in a reply / your report was handled / system).
  - Title 14/600, single line with ellipsis; merged items get a "3 items" pill after the title (9px, 1px line).
  - Excerpt 11/1.55, single line with ellipsis.
  - Time 10.5 on the right (relative time for today; "Yesterday 18:20" or "3 days ago" for yesterday and earlier).
- Merge rules: same `topicId` + `type=reply` + same date group → merged into one; the title is taken from the newest; actors deduplicated as "A, B and 1 other"; clicking jumps to the newest reply in that group (`?page=last#post-<floor>`).
- Notification pagination: **30** per page, using the site-wide PaginationBar; URL `?page=N` synced.
- Empty state: when there are no new notifications today show "No notifications yet" + "Go see the latest topics".
- Mobile: content full width; rows 28 avatar; titles may wrap to two lines; time moves below the title; "Unread only" is kept.
- The unread count is shown on the header bell; entering the page does not automatically mark everything read; you must click "Mark all as read" or click items one by one.

### 7.11 Error pages 403 / 404 / 500

- Keep the full header + footer; content centered, min height 396 (mobile 360), 40/34 top and bottom.
- Top 34×3 pine short line; error code 56/700; title 18/700; description 11.5/1.85, max 340; two buttons: back home (solid pine 34), go to search (outlined 34); 10.5 "Having trouble? Contact the administrator" (mailto) below.
- Copy:
  - 404 "This page is gone": link expired, topic deleted, mistyped address.
  - 403 "You don't have permission to view this": insufficient login state / category visibility; provide "Log in" and "Back home".
  - 500 "Something went wrong on our side": try again later; provide "Refresh" and "Back home".
- Do not show stack traces; the request ID is shown only in development.
- Mobile: buttons side by side, full width; error code 48.

### 7.12 Admin `/admin`

- Standalone layout: desktop (≥900) has a **188** dark sidebar (`--admin-side`) on the left + content on the right; the content area reuses the public tokens and no longer nests the public header.
- Mobile/tablet (<900): the sidebar becomes a 55-high top brand bar with a menu icon on the right; navigation is collapsed by default, clicking the icon expands it into vertical links and the account area, and it collapses again on a second click or page change.
- Sidebar:
  - Top 24 "工" + 15/700 "Pineboard" + 10 "Admin".
  - Group "Site": Overview, Reports (orange number 3 on the right), Category maintenance, Tag maintenance, Navigation maintenance, Site settings, Integrations, Email log, Maintenance tools, Audit log.
  - Item height 32, 2px transparent left border; active has an orange left bar + white text + 6% white fill; inactive is 70% white.
  - Bottom "← Back to forum" + 22 avatar + name/role.
- Overview page header: `h1` 19 "Overview" + 10.5 subtitle; 10.5 "Config v12 · last deployed 2 days ago" on the right.
- Four stat cells: white background, 1px line, radius 6, four columns; numbers 21/600; labels 10.5; pending report numbers orange, email failures orange.
- Pending reports: heading row 12/600 + "All →" 10.5; each list row: amber reason badge + title 12.5/600 + reporter/time 10.5; on the right "Ignore" outlined + "Handle" solid pine (24 high).
- Maintenance tools: 2×2 cards (1 column on mobile); each: tool name 11/600 + last run 10.5 + "Run →" on the right; clicking opens a confirmation dialog (title + impact description + cancel/confirm), confirm button pine; for destructive actions the confirm button uses orange text, no red block.
- Subpages reuse the same shell:
  - Reports: filters (pending/handled/rejected) + table + pagination.
  - Site settings: left group anchors/group headings + form; the save bar is fixed at the bottom and shows "Unsaved changes".
  - Category maintenance: list (color, name, slug, topic count, moderators, order/visibility) + create/edit form; inline "Manage moderators" adds or removes moderators by username/email.
  - Tag maintenance: list (color, `#name`, slug, usage count, status) + search + create/edit/show-hide; deletion is blocked while references exist.
  - Navigation maintenance: list (type, link, order, visibility) + create/edit.
  - Integrations: Cloudflare/R2/Turnstile/Resend non-secret fields + encrypted secret entry.
  - Email log: status filter + table (recipient, type, status, time) + pagination; bounce reasons are expandable.
  - Audit log: the most recent 200 operations; deleted topics/replies can be restored directly.
  - Maintenance tools: the same tool area as the overview + run history.
- Mobile (<600): top brand bar + menu button; navigation collapsed by default, expands into a vertical list; stats 2×2; tools 1 column; tables scroll horizontally.
- Permissions: moderators can only enter "Reports"; other items are hidden. Frontend hiding is not permission; the API must use `requireAdmin` (Reports allows moderator).

---

## 8. Responsive

| Breakpoint | Behavior |
|---|---|
| ≥1280 | Topic pages get a 240 related-topics right rail; home/category keep the 176 right rail |
| <1280 | List page right rails fold into an expandable block at the top; content pages stay 1180 full width |
| <900 | Home/category right rail drops below the content; profile center 188 navigation becomes horizontal tabs; admin becomes a top bar + menu button, navigation collapsed by default |
| <600 | Single column; header 50; hide table headers and number columns; list rows two lines at 60; footer kept (two lines); new topic/login buttons full width; admin top bar + menu button, navigation collapsed by default |

- Use viewport media queries, not container queries, for page-level layout (the `@container` in the design mock is only a preview shell).
- No horizontal scrolling at any width; tables/code blocks/toolbars get their own `overflow-x: auto`.
- Mobile tap targets are at least 44×44 (list rows are tappable as a whole; icon buttons get padding).
- Images `max-width:100%`; avatars fixed size; long titles/long usernames must be truncated.

---

## 9. Interaction and accessibility

- Focus: `outline: 2px solid var(--orange); outline-offset: 2px`; never `outline:none`.
- Link hover underline; current navigation `aria-current="page"`; sorting/filters use `role="tablist"` + `aria-selected`.
- Pagination `<nav aria-label="Pagination">`; current page `aria-current="page"`; disabled arrows `aria-disabled`.
- OP only / unread only use `role="switch"` + `aria-checked`.
- Forms: every input has a `<label>`; errors use `aria-describedby` + `aria-invalid`; on submit failure move focus to the summary or the first error.
- Unread notifications do not rely on the color bar alone: bold title + `aria-label="Unread"`.
- Pinned/digest badges have text; a category dot must be accompanied by a name.
- Contrast: `#5F6B66` on `#FFFFFF` ≈ 5.4:1, on `#F1F3F1` ≈ 4.8:1; dark `#96A29B` on `#151D18` ≈ 6.2:1. Orange is only for large text/icons/strokes, not for small body text.
- Respect `prefers-reduced-motion`; keep only color transitions of 120–160ms, no movement animations.
- Keyboard: Esc closes drawers/dialogs; dialogs trap focus; focus is restored on return.
- Images have `alt`; when an avatar has no image use the first character, decorated with `aria-hidden`.
- Time zones: use `Intl.DateTimeFormat` in the display layer; relative time in `<time datetime>`; site time zone by default, users may switch.

---

## 10. Data and API gaps

Deployment order is fixed: **additive migration → API → frontend**. All the interfaces below keep the `{ ok, data, meta? }` / `{ ok:false, error:{ code, message, fields? } }` envelope.

### 10.1 The 11 items already listed in v1

| # | Requirement | Change | Impact |
|---|---|---|---|
| 1 | List "last replier" | Add `lastPostUser: { id, username, name } \| null` to `TopicSummary`; `topics.last_post_user_id` LEFT JOIN `user` | Small |
| 2 | Site numbers | New `GET /api/site/stats`: `{ todayPosts, topics, replies, members }`, 60s cache | Small |
| 3 | Topic reply pagination | `GET /api/topics/:id/posts?page=&perPage=&onlyOp=`; returns `{ items, page, perPage, total, totalPages }`; keep `after` as a transition | Medium |
| 4 | Profile header likes/bookmarks | `/api/users/:username` gains `likeCount` (likes received) and `bookmarkCount`; bookmark count is public, bookmark list is owner-only | Small |
| 5 | Tag detail three numbers | New `GET /api/tags/:slug`: `{ ...tag, description, stats:{ topics, todayTopics, replies } }`; `/api/tags` gains `topicCount` + `recentTopic` | Small |
| 6 | Search sorting | `/api/search?sort=relevance\|latest`; default relevance; latest sorts by post `created_at DESC` | Small |
| 7 | Notification merging | Frontend merges by `topicId + type=reply + date group`; API adds `postFloor` to make jumping to the newest post easier | Medium |
| 8 | Notification pagination | Reuse `page/perPage`, frontend `perPage=30`; use PaginationBar, return `total/totalPages` | Small |
| 9 | New topic draft | `localStorage`, key `draft:new-topic`; no interface needed | None |
| 10 | Admin overview numbers | New `GET /api/admin/overview`: today's posts, pending reports, new members this week, email failures, config version, pending report list | Small |
| 11 | Maintenance tools | Reuse `/api/admin/search/reindex`, `/api/admin/maintenance/cleanup`, `/api/admin/emails/digest`, `/api/admin/maintenance/daily`; frontend adds confirmation | None |

Additional conventions:

- **Today** is computed with the day boundary from `site.timezone`; `todayPosts` = new topics today + new replies today (`is_first=0`).
- **Reply pagination**: page 1 returns floors 2–20 (floor 1 comes from `topicDetail.firstPost`), page 2 returns 21–40; `total` includes the first post, `totalPages = ceil(total/perPage)`. With `onlyOp=1` only OP replies are returned, still excluding the first post.
- **Tag/category stats**: `topics` = published topics; `replies` = published non-first posts; `todayTopics` = new topics today.
- **Search**: `latest` only affects sorting, it does not change the relevance ranking logic; an empty `q` returns empty results directly, without querying the database.
- **Notifications**: merging only affects display, it does not change read semantics; clicking a merged item marks all notifications in the group as read.
- **Admin overview**: "last deployed" prefers the build-injected `BUILD_TIME`; otherwise show "—", do not invent one.

### 10.2 Changes implied by the design mock but not listed in the v1 tables

These already appear in the preview and must be filled in during implementation, otherwise pages are incomplete:

1. **Digest**: `topics` gains `is_digest INTEGER NOT NULL DEFAULT 0` (additive migration); `PATCH /api/topics/:id/digest` (moderator/admin, writes audit); `GET /api/topics?digest=1`; lists return `isDigest`; the badge and the "Digest" filter use it, **do not reuse `pin_level`**.
2. **Site announcement**: `site.announcement = { id, enabled, text, href? }`; sync `DEFAULTS`, the Zod schema, the admin "Site settings" group, and `docs/02`; the frontend records the dismissed state in localStorage by `announcement.id`.
3. **Category header numbers**: `GET /api/categories/:slug` gains `stats: { topics, todayTopics, replies }`; `/api/categories` gains `todayTopics`, `replies` (used by the right rail and the homepage category entry).
4. **Tag description**: `tags.description TEXT NOT NULL DEFAULT ''` already exists in `0002_black_frank_castle.sql`; do not repeat the ALTER this time; editable in admin tag management; the detail page falls back to "Topics about #<name>" when there is no description.
5. **Maintenance run times**: the overview's "last run" currently has no source. Prefer writing `maintenance.last.<job>` (timestamp) into `settings`, updated by the corresponding interface after success; if history is needed later, add a `job_runs` table. Do not do heavy work in Cron.
6. **New-topic entry (mobile)**: the new-topic entry goes in the header drawer/logged-in menu; when logged out, clicking goes to login with `redirect=/new`.
7. **Standalone auth shell**: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` use `meta.bare` and do not render the site-wide header/footer; `/unsubscribe` likewise.
8. **PWA/offline**: when offline, the new-topic button is disabled and a banner is shown; the editor keeps the local draft; do not cache `/api/**`.

### 10.3 Not recommended

- Online users: no. It would need a Durable Object or a heartbeat table on Workers; neither the cost nor the authenticity is worth it.
- Homepage excerpts, hover-to-expand excerpts: no.
- Category column: not on the homepage; not added on category/tag pages either.
- Infinite scroll: no; use traditional page numbers everywhere.
- Rich-text HTML: keep Markdown; do not introduce contenteditable rich text into the editor.
- Threaded replies deeper than two levels: no; third-level replies still attach to the top-level parent post.
- Theme package zip/JS upload: forbidden (see the security constraints in `docs/05`).

---

## 11. Landing order and acceptance

### 11.1 Order

1. **Prerequisites**: finish the 5 spikes in `docs/06`; confirm `pnpm typecheck` / `pnpm test` / `pnpm build` are green.
2. **Migration**: `topics.is_digest`, `tags.description` (additive); update the `packages/db` schema and migration files; run `pnpm db:migrate` locally.
3. **Contracts**: `packages/shared` gains `lastPostUser`, `PostPage`, `SiteStats`, `TagDetail`, `CategoryStats`, `SearchSort`, `AdminOverview`, `isDigest`; shared by frontend and backend, do not write two copies.
4. **API**: implement per 10.1 + 10.2; add vitest (pagination boundaries, onlyOp, today's timezone, sorting, digest, overview).
5. **Frontend foundation**: replace `styles.css` tokens/typography; implement the header, list rows, pagination, editor, and empty/error/skeleton components (the homepage category bar has been removed).
6. **Pages**: Home → Category → Topic → Login/Register → Profile center/Public profile → New topic → Search → Tags → Notifications → Error pages.
7. **Admin**: shell → overview → reports → settings → email log → maintenance.
8. **Wrap-up**: E2E, visual regression, a11y, Lighthouse, real-device offline; update `README` and `docs/02` (new fields/config).

> The original v1 order put the API last; because the new pages depend on `lastPostUser`, pagination, and stats, execution actually moves the API ahead of the frontend while the page order stays the same.

### 11.2 Acceptance checklist

- [ ] No horizontal scrolling at 1440 / 1280 / 1024 / 768 / 390 widths; ≥8 rows on the homepage within 900 height.
- [ ] Sans-serif site-wide; serif appears only in the "工" mark; no card shadows; radius ≤6.
- [ ] Header 56/50, announcement 36/34, list 52, right rail 176, body full width 1180; mobile footer and copyright visible.
- [ ] List last reply shows "name + time"; shows "—" when nobody has replied.
- [ ] Topic page 20 posts/page, page numbers top and bottom, >7 page ellipsis rule, OP only, threaded replies, anchors, bottom editor.
- [ ] Category four filters (including digest), tag three sorts, search two sorts; switching sort does not lose the query.
- [ ] The search page hides the header search box; the empty state has popular tags + latest topics.
- [ ] Notifications today/yesterday/earlier, merged by topic, unread color bar, numbered pagination 30/page, merged jump to the newest post.
- [ ] Standalone auth shell, three numbers, nickname + username, Turnstile reset on failure.
- [ ] Profile center 188 navigation, four numbers, mobile horizontal tabs; public profile hides settings.
- [ ] New topic full width 1180, tag limit 5, draft restore, full-page notice when unverified, field + summary errors.
- [ ] Admin 188 dark sidebar, five-item navigation, overview four cells, maintenance confirmation, mobile top bar.
- [ ] Full light/dark tokens; follows the system by default; no theme flash on first paint.
- [ ] Keyboard can complete login, new topic, paging, OP only, dismiss announcement; focus is visible.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:e2e:p1..p6`, `pnpm build` all green.
- [ ] Regenerate visual screenshots after running the site; differences may only come from data/font rendering, never structural differences.

---

## 12. Pages not yet separately designed but that must be reused

The following pages are outside this round's page-by-page confirmation. During implementation **reuse the finalized shell and components and do not introduce a new visual language**; if new structure is truly required, update this document first, then write the code.

| Page | How to reuse |
|---|---|
| Edit topic `/t/:id/edit` | New topic page 1180 full width; title editable; add optional "reason for edit"; submit with `version` CAS; 409 shows "Content was modified, please refresh" |
| Edit reply | Switch to an editor inside the post; toolbar 32; save/cancel; same CAS |
| Revision history `/t/:id/history` | 1180 full width; version list on the left + read-only body on the right; "Current version / vN" at the top; no colored diff for now, use "added/removed" two text blocks |
| Forgot password / reset password / verify email | AuthShell single form 300; title 22; description 11.5; submit 40; success state uses a 34-high amber notice bar |
| My topics / My replies / My bookmarks | Profile center shell; list reuses 52px rows; My replies shows "Replied to <topic>" + snippet; bookmarks do not show a category column |
| Notification preferences / Account and data | Profile center shell; grouped form; save bar at the bottom; account deletion confirmation + grace period explanation |
| Report dialog | 420-wide dialog; reason radio (spam/ad hominem/illegal/off-topic/other) + description up to 1000 characters; submit pine; cancel outlined |
| Admin reports/settings/email/maintenance subpages | Admin shell; tables/grouped forms/tool cards; reuse 24–36-high controls and 1px lines |
| Unsubscribe `/unsubscribe?token=` | Centered single card 420; title 20; description 11.5; confirm/cancel; success/expired states |
| 410 | Same shell as error pages; copy "This topic has been deleted"; do not leak the title |

---

## 13. Reference image index

Screenshots are not shipped upstream; after running the site, generate your own screenshots at 1180 content width (1280 canvas) / 390 mobile. **The numbers in this document take precedence**.

| File | Content |
|---|---|
| `home.png` | Home light desktop: header, announcement, list, 176 right rail (from an older draft, category bar already removed) |
| `home-dark.png` | Home dark desktop |
| `home-mobile.png` | Home 390: two-line list, right rail folded |
| `topic.png` | Topic page: author column, threaded replies, page numbers top and bottom, bottom editor |
| `topic-mobile.png` | Topic page 390 |
| `category.png` | Category page: compact header, four filters, right rail, bottom page numbers |
| `auth-login.png` | Login page standalone shell |
| `auth-register.png` | Register page (nickname, username, Turnstile) |
| `me.png` | Profile center: 188 navigation, profile header four numbers, list |
| `new-topic.png` | New topic page: 1180, category pills, tags, Turnstile |
| `search.png` | Search results: post-level, amber highlight, two sorts |
| `search-empty.png` | Search empty state: popular tags + latest topics |
| `tags.png` | Tags overview two columns |
| `tags-detail.png` | Tag detail: three numbers, three sorts |
| `notifications.png` | Notifications: sections, merging, unread color bar |
| `error.png` | 404 error page |
| `admin.png` | Admin overview: dark sidebar, four cells, reports, maintenance |

Upstream does not ship an interactive preview; page implementation follows this document.

---

## 14. One-sentence handoff

> Replace tokens and the four base components first, then proceed "Home → Category → Topic → Auth → Profile center → New topic → Search/Tags/Notifications → Admin"; fill in the API per 10.1 first, and only add migrations, never delete. For any idea that conflicts with this document, change the document first, not the code directly.
>
> Implementation clarification (2026-10-23): `tags.description` already exists in 0002, no new column is needed; the header "Categories" is a dropdown listing visible categories, and no categories overview page is added.
