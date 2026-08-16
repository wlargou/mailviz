# Event Creation Enhancement — Google Calendar API Alignment

> **Committed deliberately.** This plan used to live in `.claude/`, which is gitignored, so it
> never survived a clone. It is kept because of one non-obvious guarantee it records: an RRULE
> that does not map onto a preset is shown read-only and never rewritten, which is what makes
> shipping without a custom recurrence builder acceptable. The tracked backlog line is the last
> checkbox under **2.3** in [`BACKLOG.md`](../../BACKLOG.md).

## Status: COMPLETE — except a custom recurrence builder, deliberately out of scope

## Gap table — as of now

The table below was stale for months: attendees, sendUpdates, Google Meet, colorId and the
date/time pickers had all shipped while it still listed them as missing. Recurrence, reminders
and visibility have since shipped too.

| Feature | Google Calendar | Our App |
|---------|----------------|---------|
| **Attendees** | Email input → auto-send invites | ✅ Chips in `EventModal`, stored with `responseStatus` |
| **Google Meet** | Toggle to auto-generate link | ✅ `conferenceData.createRequest` + `conferenceDataVersion: 1` |
| **Send updates** | Prompt: "Send updates to guests?" | ✅ Notify toggle → `sendUpdates` |
| **Recurrence** | Daily/Weekly/Monthly/Yearly/Custom | ✅ Presets on create; ❌ custom builder (see below) |
| **Reminders** | Popup/email X mins before | ✅ `useDefault` toggle + up to 5 (method, minutes) rows |
| **Color** | 11 event colors | ✅ `colorId` picker, written back to Google |
| **Visibility** | Default/Public/Private | ✅ |
| **Date/Time UX** | Proper date/time pickers | ✅ Carbon `DatePicker` + `TimePicker` |

### Recurrence — what shipped, and what did not

Presets only: Daily, Weekly on `<weekday>`, Monthly on day N, Yearly — each anchored to the
event's start date, so changing the start date re-derives the rule.

A **custom builder** (INTERVAL / COUNT / UNTIL / multi-BYDAY) is deliberately **not** built. An
existing RRULE that does not map onto a preset is displayed read-only and never rewritten, so
editing an event created elsewhere in Google Calendar cannot silently flatten its recurrence.
That guarantee is the reason the gap is acceptable; remove it and the builder becomes required.

## Plan — Phases 1+2 (Attendees + Google Meet + UX) — shipped as written

### 1. Backend Changes

**`server/src/validators/calendarValidator.ts`:**
- Add `attendees`, `sendUpdates`, `addGoogleMeet`, `colorId` to create/update schemas

**`server/src/services/calendarService.ts` → `create()` + `pushToGoogle()`:**
- Accept attendees array, pass to Google API `requestBody.attendees`
- Pass `sendUpdates` parameter to `events.insert()` / `events.update()`
- When `addGoogleMeet: true`, include `conferenceData.createRequest` + `conferenceDataVersion: 1`
- After Google API response: store returned attendees (with responseStatus) and conferenceLink in local DB
- Accept `colorId` and pass to Google API

**`server/src/services/calendarService.ts` → `update()` + `pushToGoogle()`:**
- Same attendees/conference support for updates
- When updating attendees, merge new with existing
- Pass `sendUpdates` to `events.update()` so Google handles invite emails

### 2. Frontend Changes

**`client/src/components/calendar/EventModal.tsx`:**

Replace the current basic form with a Google Calendar-inspired layout:

```
┌─────────────────────────────────────────┐
│ New Event / Edit Event                  │
├─────────────────────────────────────────┤
│ Title _________________________________ │
│                                         │
│ 📅 Start: [Mar 20, 2026] [09:00 AM]   │
│ 📅 End:   [Mar 20, 2026] [10:00 AM]   │
│ ☐ All day                               │
│                                         │
│ 👥 Add guests _________________________│
│    [john@company.com ×] [jane@co.com ×]│
│    ☑ Notify attendees                   │
│                                         │
│ 📍 Location ___________________________│
│                                         │
│ 🎥 ☐ Add Google Meet conferencing      │
│                                         │
│ 🎨 Color: [● Tomato ▾]                 │
│                                         │
│ 📝 Description                          │
│    ____________________________________│
│                                         │
│           [Cancel]  [Create Event]      │
└─────────────────────────────────────────┘
```

Key UI elements:
- **Date/Time**: Use Carbon `DatePicker` + `TimePicker` (proper components, not text inputs)
- **Attendees**: TextInput + Enter to add → renders as `DismissibleTag` chips
- **Notify toggle**: Toggle shown only when attendees exist
- **Google Meet**: Toggle with `VideoChat` icon → when on, shows "Google Meet link will be generated"
- **Color picker**: Dropdown with 11 colored swatches matching Google Calendar colors
- **When editing synced event**: Pre-populate attendees from event data, show existing conference link

### 3. Files to Change

| File | Changes |
|------|---------|
| `server/src/validators/calendarValidator.ts` | Add attendees, sendUpdates, addGoogleMeet, colorId |
| `server/src/services/calendarService.ts` | Update create/update/pushToGoogle with new fields |
| `client/src/components/calendar/EventModal.tsx` | Full redesign with attendees, Meet toggle, DatePicker, color |
| `client/src/styles/_calendar.scss` | Attendee tags, color picker, Meet toggle styles |
| `client/src/types/calendar.ts` | Update types for new create/update payloads |

### 4. Google Calendar API Specifics

**Creating with attendees + Meet:**
```js
calendar.events.insert({
  calendarId: 'primary',
  sendUpdates: 'all',
  conferenceDataVersion: 1,
  requestBody: {
    summary: title,
    attendees: [{ email: 'user@example.com' }],
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    }
  }
})
```

**Updating with sendUpdates:**
```js
calendar.events.update({
  calendarId: 'primary',
  eventId: googleEventId,
  sendUpdates: 'all',
  requestBody: { ... }
})
```

No schema migration needed — `attendees` (Json), `conferenceLink`, `colorId` columns already exist.
