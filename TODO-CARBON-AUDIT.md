# Carbon Design System Audit — Fix Plan

## 🔴 P0 — Critical (Accessibility & Security)

- [ ] **A1. Clickable divs missing keyboard accessibility**
  - Add `role="button"`, `tabIndex={0}`, `onKeyDown` to all clickable `<div>` elements
  - Files: `NeedsAttention.tsx`, `FrequentContacts.tsx`, `RecentActivity.tsx`, `CalendarDayCell.tsx`

- [ ] **A2. Missing aria-labels on icon-only buttons**
  - CalendarDayCell close button `<button>×</button>` needs `aria-label="Close"`
  - ComposeToolbar dropdown buttons need aria-labels

- [ ] **A3. Settings "Add new status" input has no visible label**
  - Carbon requires visible labels on all inputs (not just placeholder text)

## 🟠 P1 — High (Color Tokens & Inline Styles)

- [ ] **B1. Replace hardcoded hex colors in `_login.scss`**
  - `#161616` → `var(--cds-background)`
  - `#f4f4f4` → `var(--cds-text-primary)`
  - `#c6c6c6` → `var(--cds-text-secondary)`
  - `rgba(22,22,22,0.85)` → `rgba(var(--cds-background), 0.85)` or Carbon overlay token
  - `rgba(255,255,255,0.06)` → `var(--cds-border-subtle-01)`
  - `rgba(255,255,255,0.1)` → `var(--cds-layer-hover-01)`

- [ ] **B2. Replace hardcoded hex colors in `_compose.scss`**
  - `#fef3bd` highlight → use `var(--cds-highlight)` or `var(--cds-support-warning)` with opacity

- [ ] **B3. ComposeToolbar TEXT_COLORS array**
  - Replace 21 hardcoded hex values with Carbon color palette values from `@carbon/colors`

- [ ] **B4. Eliminate inline `style={{}}` objects (54+ instances)**
  - Extract to SCSS classes using Carbon spacing tokens
  - Dashboard components: `NeedsAttention`, `FrequentContacts`, `RecentActivity`, `MyDaySummary`, `UpcomingEvents`, `QuickAddTask`, `TaskStatusDonut`
  - Mail: `MailPage.tsx` inline styles
  - Tasks: `KanbanCard.tsx`, `TaskDetailModal.tsx`
  - Customers: `CustomerDetailPage.tsx`, `ContactModal.tsx`

## 🟡 P2 — Medium (Layout & Components)

- [ ] **C1. Adopt Carbon 2x Grid for page layouts**
  - Wrap all page content in `<Grid>`, `<Row>`, `<Column>`
  - Dashboard: metric tiles row, 2-col rows, 3-col row, bottom row
  - List pages: full-width single column
  - Detail pages: content area within grid columns
  - Settings: wider layout using 8+ columns

- [ ] **C2. Standardize page headers**
  - Create a shared `PageHeader` component with consistent layout:
    - Title (left), subtitle (left below), action buttons (right)
    - Use Carbon `productive-heading-05` for titles
  - Apply to all pages (Dashboard, Tasks, Customers, Contacts, Calendar, Mail, Settings)

- [ ] **C3. Use Carbon `<Breadcrumb>` for detail page navigation**
  - Replace "Back to Customers ←" / "Back to Contacts ←" text links
  - Use `<Breadcrumb>` → `<BreadcrumbItem>` from `@carbon/react`

- [ ] **C4. Replace custom buttons with Carbon Button variants**
  - `.recent-activity__view-all` → `<Button kind="ghost">`
  - `.contact-copy-btn` → `<IconButton kind="ghost">`
  - `.mail-search__clear` → `<Button kind="ghost">`
  - `.mail-search__clear-all` → `<Button kind="ghost">`

- [ ] **C5. Replace custom dropdown in ComposeToolbar**
  - Custom `DropdownMenu` → Carbon `<OverflowMenu>` or `<Popover>`

- [ ] **C6. Settings: replace Disconnect button**
  - Red text + ❌ icon → Carbon `<Button kind="danger--ghost">`

- [ ] **C7. Settings: add contrast border to color swatches**
  - Colored circles need a subtle border for accessibility (distinguishing colors against dark background)

- [ ] **C8. ContentSwitcher width on Mail page**
  - Carbon recommends constrained width — shouldn't span full page width
  - Set max-width or use auto-width ContentSwitcher

## 🟢 P3 — Low (Polish & Consistency)

- [ ] **D1. Apply Carbon type styles via SCSS mixins**
  - Page titles: `@include type.type-style('productive-heading-05')`
  - Card titles: `@include type.type-style('productive-heading-02')`
  - Body text: `@include type.type-style('body-compact-01')`
  - Helper/subtitle: `@include type.type-style('helper-text-01')`

- [ ] **D2. Dashboard "Needs Attention" — add fallback avatar**
  - When Clearbit logo fails, show company initials in a colored circle (like FrequentContacts does)

- [ ] **D3. Dashboard "View all" links**
  - Replace custom styled links with Carbon `<Link>` component

- [ ] **D4. Calendar event tooltips**
  - Add `<Tooltip>` on truncated event names in day cells

- [ ] **D5. Consistent empty states**
  - Use the shared `<EmptyState>` component consistently in all dashboard cards and tab views

- [ ] **D6. Customer/Contact table column alignment**
  - Company tags right-aligned in Contacts but centered in Customers — standardize

- [ ] **D7. Split monolithic SCSS**
  - `index.scss` (83KB) imports partials but some are still very large
  - Further split `_dashboard.scss` into per-widget files if it grows

- [ ] **D8. Mail thread hover action tooltips**
  - Ensure all icon-only action buttons on thread hover have visible tooltips (important for touch)

---

## Progress Tracking

| Priority | Total | Done | Remaining |
|----------|-------|------|-----------|
| P0 Critical | 3 | 3 | 0 |
| P1 High | 4 | 4 | 0 |
| P2 Medium | 8 | 5 | 3 |
| P3 Low | 8 | 0 | 8 |
| **Total** | **23** | **12** | **11** |
