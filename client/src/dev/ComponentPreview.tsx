import { useState } from 'react';
import { Button, ContentSwitcher, Switch, Theme } from '@carbon/react';
import { ContactDuplicatesPage } from '../components/contacts/ContactDuplicatesPage';
import { SnoozeModal } from '../components/mail/SnoozeModal';
import { TemplateSettings } from '../components/settings/TemplateSettings';
import { OnboardingSettings } from '../components/settings/OnboardingSettings';
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

function stubApis() {
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

// Applied at module load, before any component mounts — stubbing during render
// meant a state update in the render phase, which took the whole app down.
stubApis();

type Screen = 'duplicates' | 'templates' | 'snooze' | 'onboarding-tile';

export function ComponentPreview() {
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
            selectedIndex={['duplicates', 'templates', 'snooze', 'onboarding-tile'].indexOf(screen)}
            onChange={({ name }) => setScreen(name as Screen)}
            size="sm"
          >
            <Switch name="duplicates" text="Duplicates" />
            <Switch name="templates" text="Templates" />
            <Switch name="snooze" text="Snooze" />
            <Switch name="onboarding-tile" text="Setup tile" />
          </ContentSwitcher>
          <Button size="sm" kind="tertiary" onClick={() => setTheme(theme === 'g100' ? 'g10' : 'g100')}>
            {theme}
          </Button>
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
