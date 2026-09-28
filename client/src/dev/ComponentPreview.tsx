import { useState } from 'react';
import { Button, ContentSwitcher, Switch, Theme } from '@carbon/react';
import { ContactDuplicatesPage } from '../components/contacts/ContactDuplicatesPage';
import { SnoozeModal } from '../components/mail/SnoozeModal';
import { ThreadDetail } from '../components/mail/ThreadDetail';
import { MailPage } from '../components/mail/MailPage';
import { SidePanel } from '@carbon/ibm-products';
import { emailsApi } from '../api/emails';
import { contactsApi as mailContactsApi } from '../api/contacts';
import { rfpsApi } from '../api/rfps';
import { authApi } from '../api/auth';
import type { EmailMessage } from '../types/email';
import { TemplateSettings } from '../components/settings/TemplateSettings';
import { OnboardingSettings } from '../components/settings/OnboardingSettings';
import { EmptyState } from '../components/shared/EmptyState';
import { Button as CarbonButton } from '@carbon/react';
import { Calendar } from '@carbon/icons-react';
import { contactsApi } from '../api/customers';
import { templatesApi } from '../api/templates';
import { onboardingApi } from '../api/onboarding';
import type { DuplicateGroup } from '../types/customer';

/**
 * Development-only harness for reviewing screens that sit behind Google OAuth.
 *
 * Every authenticated screen in this app needs a live session to reach, which
 * makes visual review impossible without signing in. This route mounts the
 * components directly with stubbed API responses so layout, spacing and theming
 * can be checked.
 *
 * It proves nothing about integration — the data is fabricated. It is for looking
 * at pixels, and the fixtures below are shaped from the real API types so the
 * layout is exercised with realistic content lengths.
 */

const DUPLICATE_GROUPS: DuplicateGroup[] = [
  {
    id: 'g1',
    customer: { id: 'c1', name: 'Intelcom', domain: 'intelcom.co.ma', logoUrl: null },
    confidence: 'high',
    rules: ['exact_email'],
    reasons: ['Same address written differently, same domain, same name'],
    suggestedPrimaryId: 'p1',
    contacts: [
      {
        id: 'p1',
        firstName: 'Sara',
        lastName: 'Maach',
        email: 's.maach@intelcom.co.ma',
        phone: '+212 600 000 001',
        role: 'Procurement Lead',
        isVip: true,
        customerId: 'c1',
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T10:00:00.000Z',
        emailCount: 84,
        aliasEmails: [],
      },
      {
        id: 'p2',
        firstName: 'Sara',
        lastName: 'Maach',
        email: 'sara_maach@intelcom.co.ma',
        phone: null,
        role: null,
        isVip: false,
        customerId: 'c1',
        createdAt: '2026-05-14T09:12:00.000Z',
        updatedAt: '2026-05-14T09:12:00.000Z',
        emailCount: 3,
        aliasEmails: [],
      },
    ] as DuplicateGroup['contacts'],
  },
  {
    id: 'g2',
    customer: { id: 'c2', name: 'Lydec', domain: 'lydec.co.ma', logoUrl: null },
    confidence: 'medium',
    rules: ['initial_form'],
    reasons: [
      'One address is the initial form of the other on the same domain, and the names agree',
    ],
    suggestedPrimaryId: 'p3',
    contacts: [
      {
        id: 'p3',
        firstName: 'Youssef',
        lastName: 'Nadif',
        email: 'y.nadif@lydec.co.ma',
        phone: null,
        role: 'Network Engineer',
        isVip: false,
        customerId: 'c2',
        createdAt: '2026-01-08T11:00:00.000Z',
        updatedAt: '2026-01-08T11:00:00.000Z',
        emailCount: 27,
        aliasEmails: ['younes.nadif@lydec.co.ma'],
      },
      {
        id: 'p4',
        firstName: 'Youssef',
        lastName: 'Nadif',
        email: 'ynadif@lydec.co.ma',
        phone: null,
        role: null,
        isVip: false,
        customerId: 'c2',
        createdAt: '2026-03-22T14:30:00.000Z',
        updatedAt: '2026-03-22T14:30:00.000Z',
        emailCount: 6,
        aliasEmails: [],
      },
    ] as DuplicateGroup['contacts'],
  },
];

/**
 * A thread shaped like the one that exposed the reader's problems: replies
 * from Outlook on the web and from Gmail, each quoting the whole history,
 * the last one your own, a long middle, and an attachment.
 */
const OUTLOOK_QUOTE = `<div id="appendonsend"></div><hr style="display:inline-block;width:98%"><div id="divRplyFwdMsg" dir="ltr"><b>De :</b> GADI-ALAMI HICHAM &lt;h.gadialami@example.test&gt;<br><b>Envoyé :</b> jeudi 24 septembre 2026 17:01<br><b>Objet :</b> RE: Projet Migration // Fichier PEP XML</div><div>Bonjour, Faisant suite à notre dernier point, nous vous remercions de bien vouloir nous transmettre le fichier PEP comme convenu.</div><div>Cordialement,</div>`;
function threadMessage(n: number, over: Partial<EmailMessage>): EmailMessage {
  return {
    id: `m${n}`, gmailMessageId: `g${n}`, threadId: 'preview-thread', userId: 'u1',
    subject: 'RE: Projet Migration // Fichier PEP XML',
    from: 'h.gadialami@example.test', fromName: 'GADI-ALAMI HICHAM',
    to: ['me@powerm.test'], cc: ['t.eljallab@example.test', 'm.aitelhaj@example.test', 'zaki.mastour@powerm.test'],
    snippet: 'Bonjour, Faisant suite à notre dernier point, nous vous remercions de bien vouloir…',
    body: null, receivedAt: new Date(Date.now() - (9 - n) * 86_400_000).toISOString(),
    isRead: true, isStarred: false, isArchived: false, isTrashed: false, hasAttachment: false,
    sizeEstimate: null, labelIds: ['INBOX'], customerId: 'c1',
    customer: { id: 'c1', name: 'Attijariwafa', domain: 'example.test', logoUrl: null },
    attachments: [], syncedAt: null, createdAt: '', ...over,
  } as EmailMessage;
}
/** Inbox rows: unread, VIP, internal, sent, shared and snoozed, with real-length text. */
const PREVIEW_LIST = [
  { threadId: 't1', messageCount: 5, unreadCount: 1, latestEmail: threadMessage(7, { id: 'l1', isRead: false, subject: 'RE: [Audit Data Platform] Point de synchronisation', from: 'mouna.kaouni@example.test', fromName: 'Mouna Kaouni', hasAttachment: true, customer: { id: 'c1', name: 'Atlascs', domain: 'x', logoUrl: null, isVip: true }, snippet: "Bonjour à tous, J'espère que vous allez bien. Merci de trouver ci-joint le document 'intégration avec Keycloak' mis à jour.", receivedAt: new Date(Date.now() - 20 * 60_000).toISOString() }) },
  { threadId: 't2', messageCount: 1, unreadCount: 1, latestEmail: threadMessage(7, { id: 'l2', isRead: false, subject: 'Projet S3 : Atelier d’architecture - Télécom/Secops', from: 'harti@powerm.test', fromName: 'HARTI MOHAMMED', customer: { id: 'c2', name: 'Powerm', domain: 'x', logoUrl: null, isInternal: true }, snippet: 'Réunion Microsoft Teams — Rejoindre la réunion maintenant', receivedAt: new Date(Date.now() - 50 * 60_000).toISOString() }) },
  { threadId: 't3', messageCount: 3, unreadCount: 0, latestEmail: threadMessage(7, { id: 'l3', subject: 'RE: Projet Migration // Fichier PEP XML', from: 'me@powerm.test', fromName: 'L.walid (PowerM)', labelIds: ['SENT'], to: ['GADI-ALAMI HICHAM <h.gadialami@example.test>'], cc: ['t.eljallab@example.test', 'm.aitelhaj@example.test'], snippet: 'Bonjour Ssi Hicham, Bien reçu, je vous prie de nous communiquer deux créneaux…', receivedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }) },
  { threadId: 't4', messageCount: 1, unreadCount: 0, latestEmail: threadMessage(7, { id: 'l4', subject: 'Offre de prix - Redhat - la poste', from: 'imane@powerm.test', fromName: 'Imane Elkhabir', userId: 'someone-else', snippet: 'TR: Offre de prix — veuillez trouver ci-joint notre offre', receivedAt: new Date(Date.now() - 26 * 3_600_000).toISOString() }) },
  { threadId: 't5', messageCount: 2, unreadCount: 0, latestEmail: threadMessage(7, { id: 'l5', subject: 'Deal reg. extension 71523004', from: 'partner@example.test', fromName: 'Red Hat Partner', snippet: 'Your extension request has been received.', receivedAt: new Date(Date.now() - 6 * 86_400_000).toISOString() }) },
];

const PREVIEW_THREAD: EmailMessage[] = [
  threadMessage(1, { body: '<div>Bonjour, Faisant suite à notre dernier point, nous vous remercions de bien vouloir nous transmettre le fichier PEP comme convenu.</div><div>Cordialement,</div>' }),
  threadMessage(2, { from: 'me@powerm.test', fromName: 'L.walid (PowerM)', to: ['h.gadialami@example.test'], labelIds: ['SENT'], snippet: 'Bonjour Ssi Hicham, Je partage avec vous le plan d’action prévu : Phase 1…' }),
  threadMessage(3, { snippet: 'Merci, nous revenons vers vous rapidement.' }),
  threadMessage(4, { from: 'me@powerm.test', fromName: 'L.walid (PowerM)', to: ['h.gadialami@example.test'], labelIds: ['SENT'], snippet: 'Bonjour Ssi Hicham, Merci de trouver ci-joint les deux fichiers xml.' }),
  threadMessage(5, { snippet: 'Bien reçu, nous lançons les tests.' }),
  threadMessage(6, {
    snippet: 'Bonjour Ssi Walid, Veuillez trouver ci-dessous les infos demandées : Avant la récupération de la RAM…',
    hasAttachment: true,
    attachments: [{ id: 'a1', emailId: 'm6', gmailAttachmentId: 'ga1', filename: 'HMC1-lscodpool-PEP_BDI.txt', mimeType: 'text/plain', size: 18_432 } as never],
    body: `<div>Bonjour Ssi Walid,</div><div>Veuillez trouver ci-dessous les infos demandées : Avant la récupération de la RAM, # HMC1 lscodpool -p PEP_BDI --level pool</div><div class="gmail_quote"><div class="gmail_attr">On Thu, Sep 24, 2026, L.walid wrote:<br></div><blockquote class="gmail_quote">Je partage avec vous le plan d’action prévu : Phase 1 : Pool Legacy…</blockquote></div>`,
  }),
  threadMessage(7, {
    from: 'me@powerm.test', fromName: null, to: ['h.gadialami@example.test'], labelIds: ['SENT'],
    snippet: 'Bonjour Ssi Hicham, Bien reçu, je vous prie de nous communiquer deux créneaux…',
    body: `<div class="elementToProof">Bonjour Ssi Hicham,</div><div class="elementToProof">Bien reçu, je vous prie de nous communiquer deux créneaux à proposer au support IBM pour l’application des XML Legacy.</div><div>Cordialement,</div>${OUTLOOK_QUOTE}`,
  }),
];

function stubApis() {
  emailsApi.getThread = async () => ({ data: { data: PREVIEW_THREAD } }) as never;
  emailsApi.getMessage = async (id: string) =>
    ({ data: { data: PREVIEW_THREAD.find((m) => m.id === id) ?? PREVIEW_THREAD[0] } }) as never;
  emailsApi.markAsRead = async () => ({ data: {} }) as never;
  emailsApi.getThreadShares = async () => ({ data: { data: [] } }) as never;
  mailContactsApi.lookupByEmail = async () => ({ data: { data: null } }) as never;
  rfpsApi.getThreadTenders = async () =>
    ({ data: { data: { linked: [], suggested: [{ id: 'r1', name: 'Refonte AIX', reference: '70/AOO/BKAM/2026', status: 'WORKING' }] } } }) as never;
  authApi.getSignature = async () => ({ data: { data: { signature: '' } } }) as never;
  emailsApi.getThreads = async () =>
    ({ data: { data: PREVIEW_LIST, meta: { total: 32698, page: 1, limit: 20, totalPages: 1635 } } }) as never;
  emailsApi.getCategoryCounts = async () =>
    ({ data: { data: { primary: 1321, social: 2, promotions: 4210, updates: 999, forums: 508 } } }) as never;
  emailsApi.getReminders = async () =>
    ({ data: { data: [{ id: 'r1', threadId: 't5', kind: 'snooze', state: 'armed', remindAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), armedAt: '', wasInInbox: true, resolution: null }] } }) as never;
  emailsApi.getRepliesOwed = async () => ({ data: { data: [] } }) as never;
  contactsApi.getDuplicates = async () =>
    ({ data: { data: DUPLICATE_GROUPS } }) as never;
  contactsApi.merge = async () =>
    ({ data: { data: { mergedContactIds: ['p2'], aliasEmailsAdded: [] } } }) as never;

  templatesApi.getAll = async () =>
    ({
      data: {
        data: [
          {
            id: 't1',
            name: 'Quote follow-up',
            kind: 'template',
            subject: 'Following up on our quote',
            body: '<p>Hi {{firstName}},</p><p>Just checking whether you had a chance to review the quote we sent over.</p>',
            usageCount: 34,
            lastUsedAt: '2026-08-14T08:00:00.000Z',
            createdAt: '2026-04-01T08:00:00.000Z',
            updatedAt: '2026-08-14T08:00:00.000Z',
          },
          {
            id: 't2',
            name: 'Intro to PowerM',
            kind: 'template',
            subject: 'Introduction — PowerM',
            body: '<p>Hello {{firstName}},</p><p>Thanks for getting in touch.</p>',
            usageCount: 12,
            lastUsedAt: null,
            createdAt: '2026-05-02T08:00:00.000Z',
            updatedAt: '2026-05-02T08:00:00.000Z',
          },
          {
            id: 't3',
            name: 'Meeting confirmation',
            kind: 'snippet',
            subject: null,
            body: '<p>Confirming our meeting for {{today}}.</p>',
            usageCount: 3,
            lastUsedAt: null,
            createdAt: '2026-06-11T08:00:00.000Z',
            updatedAt: '2026-06-11T08:00:00.000Z',
          },
        ],
      },
    }) as never;
  templatesApi.getVariables = async () =>
    ({
      data: {
        data: [
          { name: 'firstName', description: "The recipient's first name" },
          { name: 'lastName', description: "The recipient's last name" },
          { name: 'company', description: "The recipient's company" },
          { name: 'today', description: "Today's date" },
        ],
      },
    }) as never;

  onboardingApi.getStatus = async () =>
    ({
      data: {
        data: {
          completedAt: null,
          needsOnboarding: true,
          alreadyUpAndRunning: false,
          steps: {
            googleConnected: true,
            taskStatusCount: 0,
            dealPartnerCount: 0,
            hasSignature: false,
            hasDisplayName: true,
            emailCount: 0,
          },
          blocking: ['taskStatuses', 'dealPartners'],
        },
      },
    }) as never;
}

type Screen = 'duplicates' | 'templates' | 'snooze' | 'onboarding-tile' | 'empty' | 'thread' | 'mail';

export function ComponentPreview() {
  /**
   * Stubbing happens when this preview mounts — never at module scope.
   *
   * It used to run on import, and `App.tsx` imports this file statically, so
   * every page load replaced the real `onboardingApi`, `contactsApi` and
   * `templatesApi` with fixtures. The visible symptom was the onboarding welcome
   * appearing for an account with 112k emails, because the gate was reading a
   * fabricated status that says the account is empty.
   *
   * The `import.meta.env.DEV` guard on the route did not help: it gates
   * rendering, not the import, and a module-scope side effect cannot be
   * tree-shaken — so this would have reached production.
   *
   * A `useState` initialiser rather than an effect: children render before the
   * parent's effects run, so an effect would leave the first render unstubbed.
   */
  useState(() => {
    stubApis();
    return null;
  });

  const [theme, setTheme] = useState<'g100' | 'g10'>('g100');
  const [screen, setScreen] = useState<Screen>('duplicates');
  const [snoozeOpen, setSnoozeOpen] = useState(true);

  document.documentElement.setAttribute('data-carbon-theme', theme);

  return (
    <Theme theme={theme}>
      <div data-carbon-theme={theme} style={{ minHeight: '100vh' }}>
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--cds-border-subtle-01)',
          }}
        >
          <ContentSwitcher
            selectedIndex={['duplicates', 'templates', 'snooze', 'onboarding-tile', 'empty', 'thread', 'mail'].indexOf(
              screen
            )}
            onChange={({ name }) => setScreen(name as Screen)}
            size="sm"
          >
            <Switch name="duplicates" text="Duplicates" />
            <Switch name="templates" text="Templates" />
            <Switch name="snooze" text="Snooze" />
            <Switch name="onboarding-tile" text="Setup tile" />
            <Switch name="empty" text="Empty states" />
            <Switch name="thread" text="Thread" />
            <Switch name="mail" text="Mail list" />
          </ContentSwitcher>
          <Button size="sm" kind="tertiary" onClick={() => setTheme(theme === 'g100' ? 'g10' : 'g100')}>
            {theme}
          </Button>
          {screen === 'empty' && (
            <div style={{ display: 'grid', gap: '2rem', padding: '2rem', maxWidth: '60rem' }}>
              <div>
                <p style={{ marginBottom: '0.5rem', color: 'var(--cds-text-secondary)' }}>
                  size="md" — an empty page or panel
                </p>
                <EmptyState
                  title="No duplicates found"
                  description="Every contact looks distinct. Run this again after your next sync."
                  action={<CarbonButton kind="tertiary" size="sm">Back to contacts</CarbonButton>}
                />
              </div>
              <div style={{ maxWidth: '22rem', border: '1px solid var(--cds-border-subtle-01)' }}>
                <p style={{ marginBottom: '0.5rem', color: 'var(--cds-text-secondary)' }}>
                  size="sm" — inside a dashboard card
                </p>
                <EmptyState size="sm" title="No tasks yet" />
                <EmptyState
                  size="sm"
                  icon={<Calendar size={20} />}
                  title="No upcoming events"
                  action={<CarbonButton kind="ghost" size="sm">Open Calendar</CarbonButton>}
                />
              </div>
            </div>
          )}

          {screen === 'snooze' && (
            <Button size="sm" kind="ghost" onClick={() => setSnoozeOpen(true)}>
              Reopen
            </Button>
          )}
        </div>

        <>
          {screen === 'duplicates' && <ContactDuplicatesPage />}
          {screen === 'templates' && (
            <div style={{ padding: '2rem', maxWidth: '56rem' }}>
              <TemplateSettings />
            </div>
          )}
          {screen === 'onboarding-tile' && (
            <div style={{ padding: '2rem', maxWidth: '44rem' }}>
              <OnboardingSettings />
            </div>
          )}
          {screen === 'mail' && (
            <div style={{ padding: '1rem 2rem', height: 'calc(100vh - 4rem)' }}>
              <MailPage />
            </div>
          )}
          {screen === 'thread' && (
            // The reader in the panel the Mail page uses, transform and all —
            // the containing block that misplaced every tooltip.
            <SidePanel open onRequestClose={() => setScreen('empty')} title="RE: Projet Migration // Fichier PEP XML" size="lg" className="mail-page__side-panel">
              <ThreadDetail threadId="preview-thread" />
            </SidePanel>
          )}
          {screen === 'snooze' && (
            <SnoozeModal
              open={snoozeOpen}
              subject="Re: Renewal quote for the Casablanca site"
              onClose={() => setSnoozeOpen(false)}
              onSubmit={() => setSnoozeOpen(false)}
            />
          )}
        </>
      </div>
    </Theme>
  );
}
