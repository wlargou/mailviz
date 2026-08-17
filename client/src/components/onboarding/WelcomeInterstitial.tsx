import { Button, ButtonSet } from '@carbon/react';
import { ArrowRight } from '@carbon/icons-react';
import { InterstitialScreen, InterstitialScreenView } from '@carbon/ibm-products';

interface WelcomeInterstitialProps {
  open: boolean;
  /** Whether Google is connected, so the tour states a fact rather than a hope. */
  googleConnected: boolean;
  onStartSetup: () => void;
  onSkip: () => void;
}

/**
 * The first thing a new account sees.
 *
 * `InterstitialScreen` is Carbon's component for exactly this — its own docs
 * describe it as shown "the first time a user accesses a new experience (e.g.
 * upon first login)", and it lives under Onboarding in the ibm-products
 * Storybook. It handles the step progress indicator itself; each
 * `InterstitialScreenView` contributes one step.
 *
 * Full screen rather than modal, because there is nothing behind it worth
 * showing: on first login the app has no mail, no companies and no tasks, so a
 * modal would frame an empty page.
 *
 * This screen only explains. Nothing here writes configuration — that is the
 * wizard's job, and keeping them separate is why the tour can be skipped
 * without leaving half-made settings behind.
 */
export function WelcomeInterstitial({
  open,
  googleConnected,
  onStartSetup,
  onSkip,
}: WelcomeInterstitialProps) {
  return (
    <InterstitialScreen
      open={open}
      isFullScreen
      ariaLabel="Welcome to mailviz"
      onClose={onSkip}
    >
      <InterstitialScreen.Header
        headerTitle="Welcome to mailviz"
        headerSubTitle="Your mail and your customers in one place"
      />
      <InterstitialScreen.Body
        contentRenderer={() => (
          <>
            <InterstitialScreenView stepTitle="What this is">
              <div className="onboarding-welcome__view">
                <p>
                  mailviz reads your Gmail and builds a picture of the companies behind it. Every
                  message is filed against the customer it came from, so a thread, the contact who
                  sent it, the meetings you have had and the deals in flight all sit together.
                </p>
                <p>
                  Nothing is filed by hand. Companies and contacts are created from the addresses in
                  your mail as it arrives.
                </p>
              </div>
            </InterstitialScreenView>

            <InterstitialScreenView stepTitle="What you can do">
              <div className="onboarding-welcome__view">
                <ul className="onboarding-welcome__list">
                  <li>
                    <strong>Mail</strong> — read, reply, schedule for later, snooze a thread until
                    you can deal with it, and save templates for the replies you send constantly.
                  </li>
                  <li>
                    <strong>Review</strong> — work through everything you missed, grouped by
                    company rather than as one long list.
                  </li>
                  <li>
                    <strong>Companies &amp; contacts</strong> — built from your mail, with a
                    duplicate finder for when the same person appears twice.
                  </li>
                  <li>
                    <strong>Tasks &amp; deals</strong> — turn a message into a task, or register a
                    deal against a partner.
                  </li>
                </ul>
              </div>
            </InterstitialScreenView>

            <InterstitialScreenView stepTitle="Before you start">
              <div className="onboarding-welcome__view">
                {googleConnected ? (
                  <p>
                    Your Google account is already connected — signing in was the consent, so mail
                    and calendar are syncing now.
                  </p>
                ) : (
                  <p>
                    Your Google account is not connected yet. You can link it from Settings, and
                    until then mail and calendar will stay empty.
                  </p>
                )}
                <p>
                  Two things need a moment of your input: the columns on your task board, and the
                  partner you register deals against. Setup takes about a minute, and everything in
                  it can be changed later.
                </p>
              </div>
            </InterstitialScreenView>
          </>
        )}
      />
      <InterstitialScreen.Footer
        actionButtonRenderer={({ handleGotoStep, progStep = 0, stepCount = 0 }) => {
          const lastStep = stepCount - 1;
          const goto = (target: number) =>
            handleGotoStep?.(Math.min(Math.max(target, 0), lastStep));
          return (
            <ButtonSet>
              <Button kind="ghost" size="lg" onClick={onSkip}>
                Explore on my own
              </Button>
              {progStep > 0 && (
                <Button kind="secondary" size="lg" onClick={() => goto(progStep - 1)}>
                  Back
                </Button>
              )}
              {progStep < lastStep && (
                <Button size="lg" renderIcon={ArrowRight} onClick={() => goto(progStep + 1)}>
                  Next
                </Button>
              )}
              {progStep === lastStep && (
                <Button size="lg" renderIcon={ArrowRight} onClick={onStartSetup}>
                  Set up mailviz
                </Button>
              )}
            </ButtonSet>
          );
        }}
      />
    </InterstitialScreen>
  );
}
