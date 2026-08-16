# Mailviz Database Schema

## Entity Relationship Diagram

```mermaid
erDiagram
    User ||--o| GoogleAuth : "has"
    User ||--o{ Task : "owns"
    User ||--o{ Customer : "owns"
    User ||--o{ Label : "owns"
    User ||--o{ Email : "owns"
    User ||--o{ CalendarEvent : "owns"
    User ||--o{ TaskStatus : "owns"
    User ||--o{ CompanyCategory : "owns"
    User ||--o{ DealPartner : "owns"
    User ||--o{ Deal : "owns"
    User ||--o{ ScheduledEmail : "owns"
    User ||--o{ Task : "assigned to"
    User ||--o{ EmailThreadShare : "shares sent"
    User ||--o{ EmailThreadShare : "shares received"
    User ||--o{ DealShare : "shares sent"
    User ||--o{ DealShare : "shares received"
    User ||--o{ TaskShare : "shares sent"
    User ||--o{ TaskShare : "shares received"

    Customer ||--o{ Contact : "has"
    Customer ||--o{ Task : "linked"
    Customer ||--o{ Email : "linked"
    Customer ||--o{ Deal : "linked"
    Customer ||--o{ CalendarEventCustomer : "linked"
    Customer }o--o| CompanyCategory : "categorized"

    Task ||--o{ TaskLabel : "has"
    Task ||--o| MailToTask : "from email"
    Task ||--o{ TaskShare : "shared"

    Label ||--o{ TaskLabel : "applied to"

    Email ||--o{ EmailAttachment : "has"
    Email ||--o| MailToTask : "converted to task"
    Email ||--o{ ScheduledEmail : "reply to"

    CalendarEvent ||--o{ CalendarEventCustomer : "linked"

    DealPartner ||--o{ Deal : "has"
    Deal ||--o{ DealShare : "shared"

    User {
        uuid id PK
        varchar email UK
        varchar name
        varchar avatar_url
        timestamp created_at
        timestamp updated_at
    }

    GoogleAuth {
        uuid id PK
        text access_token
        text refresh_token
        timestamp token_expiry
        varchar email
        text scope
        timestamp last_sync_at
        timestamp last_mail_sync_at
        varchar last_history_id
        text calendar_sync_token
        uuid user_id FK-UK
    }

    Task {
        uuid id PK
        varchar title
        text description
        varchar status
        enum priority "LOW|MEDIUM|HIGH|URGENT"
        timestamp due_date
        int position
        int estimated_minutes
        uuid customer_id FK
        uuid assigned_to_id FK
        uuid user_id FK
    }

    TaskStatus {
        uuid id PK
        varchar name
        varchar label
        varchar color
        int position
        uuid user_id FK
    }

    CompanyCategory {
        uuid id PK
        varchar name
        varchar label
        varchar color
        int position
        uuid user_id FK
    }

    Customer {
        uuid id PK
        varchar name
        varchar email
        varchar phone
        varchar company
        varchar website
        varchar domain
        varchar logo_url
        text notes
        uuid category_id FK
        boolean is_vip
        boolean is_internal
        uuid user_id FK
    }

    Contact {
        uuid id PK
        varchar first_name
        varchar last_name
        varchar email
        varchar phone
        varchar role
        boolean is_vip
        uuid customer_id FK
    }

    Label {
        uuid id PK
        varchar name
        varchar color
        uuid user_id FK
    }

    TaskLabel {
        uuid task_id PK-FK
        uuid label_id PK-FK
    }

    Email {
        uuid id PK
        varchar gmail_message_id
        varchar thread_id
        varchar subject
        varchar from_address
        varchar from_name
        array to
        array cc
        array bcc
        varchar message_id
        text snippet
        text body
        timestamp received_at
        boolean is_read
        boolean is_starred
        boolean is_archived
        boolean is_trashed
        boolean has_attachment
        int size_estimate
        array label_ids
        uuid customer_id FK
        uuid user_id FK
    }

    EmailAttachment {
        uuid id PK
        uuid email_id FK
        varchar gmail_attachment_id
        varchar filename
        varchar mime_type
        int size
    }

    MailToTask {
        uuid id PK
        uuid email_id FK-UK
        uuid task_id FK-UK
        text conversion_note
    }

    CalendarEvent {
        uuid id PK
        varchar google_event_id
        varchar title
        text description
        timestamp start_time
        timestamp end_time
        varchar location
        boolean is_all_day
        varchar calendar_id
        varchar color_id
        jsonb attendees
        varchar conference_link
        varchar recurring_event_id
        array recurrence
        uuid user_id FK
    }

    CalendarEventCustomer {
        uuid calendar_event_id PK-FK
        uuid customer_id PK-FK
    }

    DealPartner {
        uuid id PK
        varchar name
        varchar registration_url
        varchar logo_url
        uuid user_id FK
    }

    Deal {
        uuid id PK
        varchar title
        uuid partner_id FK
        uuid customer_id FK
        text products
        varchar status "TO_CHALLENGE|APPROVED|DECLINED"
        timestamp expiry_date
        text notes
        uuid user_id FK
    }

    EmailThreadShare {
        uuid id PK
        varchar thread_id
        uuid shared_by_user_id FK
        uuid shared_with_user_id FK
    }

    DealShare {
        uuid id PK
        uuid deal_id FK
        uuid shared_by_user_id FK
        uuid shared_with_user_id FK
    }

    TaskShare {
        uuid id PK
        uuid task_id FK
        uuid shared_by_user_id FK
        uuid shared_with_user_id FK
    }

    ScheduledEmail {
        uuid id PK
        uuid user_id FK
        varchar status "pending|sent|failed|cancelled"
        timestamp send_at
        varchar mode "new|reply|forward"
        array to
        array cc
        array bcc
        varchar subject
        text html_body
        json attachments
        uuid reply_to_email_id FK
        varchar sent_message_id
        varchar sent_thread_id
        text error_message
        int retry_count
    }
```

## Summary

| Model | Description | Records |
|-------|-------------|---------|
| **User** | Authenticated users (Google OAuth) | Multi-tenant root |
| **GoogleAuth** | Google OAuth tokens + sync state | 1:1 with User |
| **Task** | Tasks with priority, status, labels, assignment | Per-user |
| **TaskStatus** | Dynamic Kanban board columns | Per-user |
| **CompanyCategory** | Company classification (Customer, Partner, Distributor) | Per-user |
| **Customer** | Companies (auto-created from email domains) | Per-user |
| **Contact** | People within companies | Via Customer |
| **Label** | Task tags/labels | Per-user |
| **Email** | Synced Gmail messages | Per-user |
| **EmailAttachment** | File attachments on emails | Via Email |
| **CalendarEvent** | Synced Google Calendar events | Per-user |
| **Deal** | Deal registrations with partners | Per-user |
| **DealPartner** | Partner companies (IBM, RedHat, etc.) | Per-user |
| **ScheduledEmail** | Emails scheduled for future sending | Per-user |
| **EmailThreadShare** | Email thread sharing between users | Junction |
| **DealShare** | Deal sharing between users | Junction |
| **TaskShare** | Task sharing between users | Junction |
| **MailToTask** | Email → Task conversion link | Junction |
| **TaskLabel** | Task ↔ Label many-to-many | Junction |
| **CalendarEventCustomer** | Event ↔ Company many-to-many | Junction |

## Key Design Decisions

- **Multi-tenant**: Every data model has `userId` for tenant isolation
- **Compound unique constraints**: `(userId, domain)` on Customer, `(userId, gmailMessageId)` on Email, etc.
- **Sharing**: Dedicated share tables with sender/receiver tracking
- **Dynamic statuses**: Task statuses stored in DB, not enums (user-customizable Kanban)
- **Soft classification**: Companies can be VIP or Internal (user's own domain)
- **Cascade deletes**: Deleting a User cascades to all their data
