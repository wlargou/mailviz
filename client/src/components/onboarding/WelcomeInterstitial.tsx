import { useEffect, useRef } from 'react';
import { Button } from '@carbon/react';
import { ArrowRight, Email, Building, Money, Time } from '@carbon/icons-react';
import { MailvizLogo } from '../shared/MailvizLogo';

interface WelcomeInterstitialProps {
  open: boolean;
  /** Whether Google is connected, so the tour states a fact rather than a hope. */
  googleConnected: boolean;
  onStartSetup: () => void;
  onSkip: () => void;
}

/**
 * The first screen a new account sees — a full-page welcome.
 *
 * Built from Carbon primitives and tokens rather than wrapped around
 * `InterstitialScreen`. That component was the first attempt and it was the
 * wrong tool here: its full-screen variant is laid out for substantial content
 * or artwork, so three short paragraphs left most of the viewport empty, and its
 * footer applies `cds--btn-set` by descendant selector, stretching every button
 * into a full-width slab. Fighting that produced a worse result than composing
 * the layout directly.
 *
 * The visual language is deliberately the login page's — the same orbit mark,
 * the same gradient field, the same light type weight — so signing in and
 * arriving read as one continuous moment rather than two unrelated screens.
 */

const CAPABILITIES = [
  {
    icon: Email,
    title: 'Mail that knows its sender',
    body: 'Reply, schedule, snooze, and keep templates for what you send constantly.',
  },
  {
    icon: Time,
    title: 'Catch up by company',
    body: 'Review groups what you missed by the company behind it, not one endless list.',
  },
  {
    icon: Building,
    title: 'Customers build themselves',
    body: 'Companies and contacts come from your inbox, with a finder for duplicates.',
  },
  {
    icon: Money,
    title: 'Tasks and deals in context',
    body: 'Turn a thread into a task, or register a deal against a partner.',
  },
];

export function WelcomeInterstitial({
  open,
  googleConnected,
  onStartSetup,
  onSkip,
}: WelcomeInterstitialProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  /**
   * Move focus into the overlay and let Escape dismiss it.
   *
   * The screen covers the app and is announced as a dialog, so leaving focus on
   * whatever was behind it would strand a keyboard or screen-reader user outside
   * the thing they are looking at. This is not a full focus trap — tabbing can
   * still reach the app underneath, which is tracked as a follow-up.
   */
  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onSkip]);

  if (!open) return null;

  return (
    <div className="onboarding-welcome" role="dialog" aria-modal="true" aria-label="Welcome to mailviz">
      <div className="onboarding-welcome__field" aria-hidden="true" />

      <div className="onboarding-welcome__inner">
        <div className="onboarding-welcome__col">
        <header className="onboarding-welcome__head">
          <div className="onboarding-welcome__mark">
            <MailvizLogo size={72} variant="animated" />
          </div>
          <p className="onboarding-welcome__eyebrow">Welcome</p>
          <h1 className="onboarding-welcome__title">
            Your mail and your customers, in one place
          </h1>
          <p className="onboarding-welcome__lead">
            mailviz reads your Gmail and builds a picture of the companies behind it. A thread, the
            person who sent it, the meetings you have had and the deals in flight all sit together —
            assembled as your mail arrives, not filed by you.
          </p>
        </header>

        <footer className="onboarding-welcome__foot">
          <p className="onboarding-welcome__status">
            {googleConnected ? (
              <>
                <span className="onboarding-welcome__dot onboarding-welcome__dot--ok" />
                Google is connected — signing in was the consent, so your mail and calendar are
                syncing now. Two small things need you: your board columns, and the partner you
                register deals against.
              </>
            ) : (
              <>
                <span className="onboarding-welcome__dot onboarding-welcome__dot--warn" />
                Google is not connected yet, so mail and calendar stay empty until you link it in
                Settings.
              </>
            )}
          </p>
          <div className="onboarding-welcome__actions">
            <Button ref={primaryRef} size="lg" renderIcon={ArrowRight} onClick={onStartSetup}>
              Set up mailviz
            </Button>
            <Button kind="ghost" size="lg" onClick={onSkip}>
              Explore on my own
            </Button>
          </div>
          <p className="onboarding-welcome__fineprint">
            Takes about a minute. Everything is editable later.
          </p>
        </footer>
        </div>

        <ul className="onboarding-welcome__grid">
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="onboarding-welcome__card">
              <span className="onboarding-welcome__card-icon">
                <Icon size={20} />
              </span>
              <h2 className="onboarding-welcome__card-title">{title}</h2>
              <p className="onboarding-welcome__card-body">{body}</p>
            </li>
          ))}
        </ul>

      </div>
    </div>
  );
}
