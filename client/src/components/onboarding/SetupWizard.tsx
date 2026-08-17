import { useState } from 'react';
import { CreateTearsheet, CreateTearsheetStep } from '@carbon/ibm-products';
import {
  InlineNotification,
  ListItem,
  SkeletonText,
  Tag,
  TextArea,
  TextInput,
  UnorderedList,
} from '@carbon/react';
import { CheckmarkFilled } from '@carbon/icons-react';
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
 * A wide `CreateTearsheet` rather than a side panel or narrow tearsheet: the
 * repo's own container rubric puts a multi-step interactive flow here, and there
 * is no page context worth keeping visible — behind this is an empty app.
 *
 * Each step writes on `onNext` rather than batching everything into the final
 * submit. Setup is not a transaction: someone who gets three steps in and closes
 * the tearsheet should keep those three steps, not lose them.
 */
export function SetupWizard({ open, status, onFinish }: SetupWizardProps) {
  const addNotification = useUIStore((state) => state.addNotification);

  const [partnerName, setPartnerName] = useState('');
  const [signature, setSignature] = useState('');
  const [seeded, setSeeded] = useState<number | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  const hasColumns = status.steps.taskStatusCount > 0;
  const hasPartner = status.steps.dealPartnerCount > 0;

  /**
   * A failed step must not advance. `onNext` rejecting is how CreateTearsheet is
   * told to stay put, so the error is surfaced and re-thrown rather than
   * swallowed into a notification.
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

  return (
    <CreateTearsheet
      open={open}
      title="Set up mailviz"
      description="Three short steps. You can change any of this later in Settings."
      label="First-time setup"
      backButtonText="Back"
      cancelButtonText="Finish later"
      nextButtonText="Next"
      submitButtonText="Done"
      onClose={() => onFinish({ skipped: true })}
      onRequestSubmit={() => onFinish({ skipped: false })}
    >
      <CreateTearsheetStep
        title="Your task board"
        subtitle="The board needs columns before it can hold anything."
        hasFieldset={false}
        onNext={async () => {
          await guard('Board columns', async () => {
            const { data } = await onboardingApi.seedTaskStatuses();
            setSeeded(data.data.created);
          });
        }}
      >
        {hasColumns ? (
          <div className="onboarding-step">
            <p className="onboarding-step__note">
              <CheckmarkFilled size={16} className="onboarding-step__ok" />
              You already have {status.steps.taskStatusCount} column
              {status.steps.taskStatusCount === 1 ? '' : 's'}. Nothing to do here — this step will
              leave them exactly as they are.
            </p>
          </div>
        ) : (
          <div className="onboarding-step">
            <p className="onboarding-step__body">
              Tasks live on a Kanban board, and the columns are yours to name. We&apos;ll start you
              with three:
            </p>
            <UnorderedList className="onboarding-step__list">
              <ListItem>
                <Tag type="blue">To do</Tag>
              </ListItem>
              <ListItem>
                <Tag type="warm-gray">In progress</Tag>
              </ListItem>
              <ListItem>
                <Tag type="green">Done</Tag>
              </ListItem>
            </UnorderedList>
            <p className="onboarding-step__note">
              Add, rename, recolour or reorder them any time in Settings → Task statuses.
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
          </div>
        )}
      </CreateTearsheetStep>

      <CreateTearsheetStep
        title="Who you sell with"
        subtitle="Optional — but a deal cannot be created without at least one partner."
        fieldsetLegendText="First deal partner"
        fieldsetLegendId="onboarding-partner-legend"
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
          {hasPartner ? (
            <p className="onboarding-step__note">
              <CheckmarkFilled size={16} className="onboarding-step__ok" />
              You already have {status.steps.dealPartnerCount} partner
              {status.steps.dealPartnerCount === 1 ? '' : 's'}. Add another if you like, or carry on.
            </p>
          ) : (
            <p className="onboarding-step__body">
              Every deal is registered against a partner — a vendor or distributor you register
              business with. Name one to get started; you can add the rest later.
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
        </div>
      </CreateTearsheetStep>

      <CreateTearsheetStep
        title="How you sign off"
        subtitle="Added to the bottom of every message you compose."
        fieldsetLegendText="Email signature"
        fieldsetLegendId="onboarding-signature-legend"
        onNext={async () => {
          const value = signature.trim();
          if (!value) return;
          await guard('Signature', async () => {
            await authApi.updateSignature(value);
          });
        }}
      >
        <div className="onboarding-step">
          {status.steps.hasSignature ? (
            <p className="onboarding-step__note">
              <CheckmarkFilled size={16} className="onboarding-step__ok" />
              You already have a signature. Anything you type here replaces it.
            </p>
          ) : (
            <p className="onboarding-step__body">
              Your signature is inserted when a compose window opens, so it is there before you
              start typing rather than something to remember at the end.
            </p>
          )}
          <TextArea
            id="onboarding-signature"
            labelText="Signature"
            placeholder={'Best regards,\nYour name\nYour title'}
            helperText="Leave blank to skip. Editable any time in Settings."
            rows={5}
            value={signature}
            onChange={(event) => setSignature(event.target.value)}
          />
        </div>
      </CreateTearsheetStep>

      <CreateTearsheetStep
        title="You're set"
        subtitle="Here is what is already happening in the background."
        hasFieldset={false}
      >
        <div className="onboarding-step">
          <p className="onboarding-step__body">
            Signing in with Google connected your mail and calendar, so there is nothing else to
            authorise. Two schedulers are already running:
          </p>
          <UnorderedList className="onboarding-step__list">
            <ListItem>
              <strong>Mail</strong> syncs every minute. Companies and contacts are created
              automatically from the addresses it sees.
            </ListItem>
            <ListItem>
              <strong>Calendar</strong> syncs every two minutes and links events to those same
              companies.
            </ListItem>
          </UnorderedList>
          {status.steps.emailCount > 0 ? (
            <p className="onboarding-step__note">
              <CheckmarkFilled size={16} className="onboarding-step__ok" />
              {status.steps.emailCount.toLocaleString()} messages have arrived so far.
            </p>
          ) : (
            <div className="onboarding-step__pending">
              <p className="onboarding-step__note">
                The first sync is still running. Your mailbox will fill in over the next few minutes
                — no need to wait here.
              </p>
              <SkeletonText paragraph lineCount={2} />
            </div>
          )}
        </div>
      </CreateTearsheetStep>

      {stepError && (
        <InlineNotification
          kind="error"
          lowContrast
          title="Something went wrong"
          subtitle={stepError}
          onCloseButtonClick={() => setStepError(null)}
        />
      )}
    </CreateTearsheet>
  );
}
