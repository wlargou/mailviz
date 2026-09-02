import { useState } from 'react';
import { CreateFullPage, CreateFullPageStep } from '@carbon/ibm-products';
import { InlineNotification, Tag, TextArea, TextInput } from '@carbon/react';
import { CheckmarkFilled, Time, Building } from '@carbon/icons-react';
import { onboardingApi } from '../../api/onboarding';
import { dealPartnersApi } from '../../api/dealPartners';
import { authApi } from '../../api/auth';
import { useUIStore } from '../../store/uiStore';
import type { OnboardingStatus } from '../../types/onboarding';

interface SetupWizardProps {
  open: boolean;
  status: OnboardingStatus;
  /** Called once setup is finished or dismissed — the parent marks it complete. */
  onFinish: (opts: { skipped: boolean }) => void;
}

/**
 * First-run setup.
 *
 * `CreateFullPage`, not a tearsheet. A tearsheet was the first choice from the
 * container rubric, and seeing it rendered changed the answer: it appears inset
 * with the app showing around its edges, so arriving from a full-page welcome
 * into a floating panel breaks the moment in half. Carbon's full-page create
 * flow is the variant for a task that owns the screen, which first-run setup
 * does — there is no page context behind it worth preserving.
 *
 * Each step is copy plus a supporting panel. That is not decoration: a full-page
 * flow hands every step the whole viewport, and three lines of text in that space
 * looks unfinished. The panels also do work prose cannot — the signature step
 * previews what you typed as it will actually appear under a message.
 *
 * Each step writes on `onNext` rather than batching into the final submit. Setup
 * is not a transaction: someone three steps in who leaves keeps those three steps.
 */
export function SetupWizard({ status, onFinish }: SetupWizardProps) {
  const addNotification = useUIStore((state) => state.addNotification);

  const [partnerName, setPartnerName] = useState('');
  const [signature, setSignature] = useState('');
  const [seeded, setSeeded] = useState<number | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  const hasColumns = status.steps.taskStatusCount > 0;
  const hasPartner = status.steps.dealPartnerCount > 0;

  /**
   * A failed step must not advance. A rejected `onNext` is how CreateFullPage is
   * told to stay put, so the error is surfaced *and* re-thrown rather than
   * swallowed into a notification the user can miss.
   */
  async function guard(label: string, work: () => Promise<void>) {
    setStepError(null);
    try {
      await work();
    } catch {
      setStepError(`${label} could not be saved. Your other steps are unaffected.`);
      throw new Error(label);
    }
  }

  /**
   * Rendered inside each step rather than once at the flow level: CreateFullPage
   * accepts only step children, and an error belongs beside the field that caused
   * it anyway.
   */
  const errorBanner = stepError ? (
    <InlineNotification
      kind="error"
      lowContrast
      title="Something went wrong"
      subtitle={stepError}
      onCloseButtonClick={() => setStepError(null)}
    />
  ) : null;

  const already = (text: string) => (
    <p className="onboarding-step__note">
      <CheckmarkFilled size={16} className="onboarding-step__ok" />
      {text}
    </p>
  );

  return (
    // CreateFullPage is built to *be* a page — it does not portal itself or
    // position fixed, so as an overlay inside the app shell it would sit in the
    // document flow and stop short of the viewport. This frame gives it the full
    // screen it expects, putting its action bar on the bottom edge.
    <div className="onboarding-fullpage">
      <CreateFullPage
        title="Set up mailviz"
        secondaryTitle="A minute of setup, then you are done"
        backButtonText="Back"
        cancelButtonText="Finish later"
        nextButtonText="Next"
        submitButtonText="Start using mailviz"
        // Setup writes each step as it completes, so leaving keeps what is saved.
        // The modal says that rather than implying the work is discarded.
        modalTitle="Leave setup?"
        modalDescription="Anything you have already completed is saved. You can pick this up again from Settings."
        modalDangerButtonText="Leave setup"
        modalSecondaryButtonText="Keep going"
        onClose={() => onFinish({ skipped: true })}
        onRequestSubmit={async () => {
          onFinish({ skipped: false });
        }}
      >
        <CreateFullPageStep
          title="Your task board"
          subtitle="The board needs columns before it can hold anything."
          hasFieldset={false}
          onNext={async () => {
            await guard('Board columns', async () => {
              const { data } = await onboardingApi.seedTaskStatuses();
              setSeeded(data.data.created);
              /**
               * Labels are seeded here too, and deliberately without their own
               * step. Nothing in the mail sync can infer that a thread is about
               * billing rather than presales, so an account that never sets any
               * shows a permanently empty label column — but that is not worth
               * a wizard page of its own. Both are "your board", both are
               * no-ops when something already exists, and both are renameable
               * in Settings.
               *
               * Its failure is swallowed on purpose: the columns are what this
               * step promises, and losing them to a labels error would be a bad
               * trade.
               */
              await onboardingApi.seedLabels().catch(() => {});
            });
          }}
        >
          <div className="onboarding-step">
            <div className="onboarding-step__main">
              {hasColumns
                ? already(
                    `You already have ${status.steps.taskStatusCount} column${
                      status.steps.taskStatusCount === 1 ? '' : 's'
                    }. This step leaves them exactly as they are.`
                  )
                : (
                  <p className="onboarding-step__body">
                    Tasks live on a Kanban board and the columns are yours to name. We will start you
                    with three — enough to be useful, few enough to change.
                  </p>
                )}
              <p className="onboarding-step__note">
                Add, rename, recolour or reorder them any time in Settings → Task statuses. We will
                also add four starter labels — Billing, Presales, Contract and Support — to tag
                tasks with. Rename them to match your work.
              </p>
              {seeded !== null && seeded > 0 && (
                <InlineNotification
                  kind="success"
                  lowContrast
                  hideCloseButton
                  title="Columns created"
                  subtitle={`${seeded} columns are ready on your board.`}
                />
              )}
              {errorBanner}
            </div>

            {/* A sketch of the board, so the columns are something you can see
                rather than three words in a sentence. */}
            <aside className="onboarding-step__aside" aria-hidden="true">
              <p className="onboarding-step__aside-label">Your board will look like this</p>
              <div className="onboarding-board">
                {[
                  { label: 'To do', tag: 'blue' as const, cards: 2 },
                  { label: 'In progress', tag: 'warm-gray' as const, cards: 1 },
                  { label: 'Done', tag: 'green' as const, cards: 1 },
                ].map((column) => (
                  <div key={column.label} className="onboarding-board__col">
                    <Tag type={column.tag} size="sm">
                      {column.label}
                    </Tag>
                    {Array.from({ length: column.cards }).map((_, index) => (
                      <div key={index} className="onboarding-board__card">
                        <span className="onboarding-board__line" />
                        <span className="onboarding-board__line onboarding-board__line--short" />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </CreateFullPageStep>

        <CreateFullPageStep
          title="Who you sell with"
          subtitle="Optional, but a deal cannot be created without at least one partner."
          fieldsetLegendText="First deal partner"
          onNext={async () => {
            const name = partnerName.trim();
            if (!name) return;
            await guard('Deal partner', async () => {
              await dealPartnersApi.create({ name });
              addNotification({ kind: 'success', title: `${name} added as a deal partner` });
            });
          }}
        >
          <div className="onboarding-step">
            <div className="onboarding-step__main">
              {hasPartner
                ? already(
                    `You already have ${status.steps.dealPartnerCount} partner${
                      status.steps.dealPartnerCount === 1 ? '' : 's'
                    }. Add another if you like, or carry on.`
                  )
                : (
                  <p className="onboarding-step__body">
                    Deals are registered against a partner — the vendor or distributor you take
                    business through. Name one now and the deal form will have something to select.
                  </p>
                )}
              <TextInput
                id="onboarding-partner-name"
                labelText="Partner name"
                placeholder="e.g. Dell, IBM, Fortinet"
                helperText="Leave blank to skip this step."
                value={partnerName}
                onChange={(event) => setPartnerName(event.target.value)}
              />
              {errorBanner}
            </div>

            <aside className="onboarding-step__aside">
              <p className="onboarding-step__aside-label">Where this shows up</p>
              <ul className="onboarding-facts">
                <li className="onboarding-facts__item">
                  <Building size={16} />
                  <span>
                    On the <strong>Deals</strong> board, as the partner a registration belongs to.
                  </span>
                </li>
                <li className="onboarding-facts__item">
                  <Time size={16} />
                  <span>
                    Against expiry dates, so a registration about to lapse can be found before it
                    lapses.
                  </span>
                </li>
              </ul>
            </aside>
          </div>
        </CreateFullPageStep>

        <CreateFullPageStep
          title="How you sign off"
          subtitle="Added to the bottom of every message you compose."
          fieldsetLegendText="Email signature"
          onNext={async () => {
            const value = signature.trim();
            if (!value) return;
            await guard('Signature', async () => {
              await authApi.updateSignature(value);
            });
          }}
        >
          <div className="onboarding-step">
            <div className="onboarding-step__main">
              {status.steps.hasSignature
                ? already('You already have a signature. Anything you type here replaces it.')
                : (
                  <p className="onboarding-step__body">
                    Your signature is inserted when a compose window opens, so it is already there
                    rather than something to remember at the end.
                  </p>
                )}
              <TextArea
                id="onboarding-signature"
                labelText="Signature"
                placeholder={'Best regards,\nYour name\nYour title'}
                helperText="Leave blank to skip. Editable any time in Settings."
                rows={6}
                value={signature}
                onChange={(event) => setSignature(event.target.value)}
              />
              {errorBanner}
            </div>

            {/* Shows the signature as it will actually appear. A textarea alone
                cannot — line breaks in a form field do not read as a sign-off
                sitting under a message. */}
            <aside className="onboarding-step__aside">
              <p className="onboarding-step__aside-label">Preview</p>
              <div className="onboarding-preview">
                <p className="onboarding-preview__body">
                  Thanks — that works for me. I will send the revised figures over tomorrow morning.
                </p>
                {signature.trim() ? (
                  <p className="onboarding-preview__signature">{signature}</p>
                ) : (
                  <p className="onboarding-preview__signature onboarding-preview__signature--empty">
                    Your signature will appear here.
                  </p>
                )}
              </div>
            </aside>
          </div>
        </CreateFullPageStep>

        <CreateFullPageStep
          title="You're set"
          subtitle="Here is what is already running."
          hasFieldset={false}
        >
          <div className="onboarding-step">
            <div className="onboarding-step__main">
              <p className="onboarding-step__body">
                Signing in with Google connected your mail and calendar, so there is nothing else to
                authorise. Two schedulers are already at work.
              </p>
              <ul className="onboarding-facts">
                <li className="onboarding-facts__item">
                  <span className="onboarding-facts__dot" />
                  <span>
                    <strong>Mail</strong> syncs every minute. Companies and contacts are created from
                    the addresses it sees.
                  </span>
                </li>
                <li className="onboarding-facts__item">
                  <span className="onboarding-facts__dot" />
                  <span>
                    <strong>Calendar</strong> syncs every two minutes and links events to those same
                    companies.
                  </span>
                </li>
              </ul>
            </div>

            <aside className="onboarding-step__aside">
              <p className="onboarding-step__aside-label">Mailbox</p>
              <div className="onboarding-count">
                {status.steps.emailCount > 0 ? (
                  <>
                    <span className="onboarding-count__value">
                      {status.steps.emailCount.toLocaleString()}
                    </span>
                    <span className="onboarding-count__label">messages synced so far</span>
                  </>
                ) : (
                  <>
                    <span className="onboarding-count__value onboarding-count__value--pending">
                      Syncing
                    </span>
                    <span className="onboarding-count__label">
                      The first pass is running now. Your mailbox fills in over the next few minutes
                      — no need to wait here.
                    </span>
                  </>
                )}
              </div>
            </aside>
          </div>
        </CreateFullPageStep>
      </CreateFullPage>
    </div>
  );
}
