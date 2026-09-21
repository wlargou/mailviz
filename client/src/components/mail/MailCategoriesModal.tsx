import { useEffect, useState } from 'react';
import { Modal, Checkbox } from '@carbon/react';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/authStore';
import { useUIStore } from '../../store/uiStore';
import { MAIL_CATEGORY_LABELS, OPTIONAL_MAIL_CATEGORIES, type OptionalMailCategory } from '../../utils/mailCategories';

interface MailCategoriesModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Which category tabs the inbox shows — Gmail's "Configure inbox", reduced
 * to the four switches it is. Primary is not offered: it is the default
 * view, and an inbox with no default is not an inbox. A `Modal` (sm) per the
 * container rubric: four checkboxes.
 */
export function MailCategoriesModal({ open, onClose }: MailCategoriesModalProps) {
  const updateUser = useAuthStore((s) => s.updateUser);
  const addNotification = useUIStore((s) => s.addNotification);
  const [tabs, setTabs] = useState<OptionalMailCategory[]>([]);
  const [saving, setSaving] = useState(false);

  // Seed from the stored preference when it opens — and only then. Seeding on
  // every change of the stored list looked equivalent, but the session user
  // is refetched in the background and each refetch is a new array, so a
  // toggle was silently reverted before Save could send it. Read through the
  // store rather than the render value for the same reason.
  useEffect(() => {
    if (!open) return;
    const stored = useAuthStore.getState().user?.mailCategoryTabs;
    setTabs(stored ? OPTIONAL_MAIL_CATEGORIES.filter((c) => stored.includes(c)) : [...OPTIONAL_MAIL_CATEGORIES]);
  }, [open]);

  const toggle = (category: OptionalMailCategory, checked: boolean) => {
    setTabs((prev) => (checked ? [...prev, category] : prev.filter((c) => c !== category)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await authApi.updateMailCategoryTabs(tabs);
      updateUser({ mailCategoryTabs: data.data.mailCategoryTabs });
      onClose();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to save the inbox categories' });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      onRequestSubmit={handleSave}
      onSecondarySubmit={onClose}
      modalHeading="Inbox categories"
      modalLabel="Mail"
      size="sm"
      primaryButtonText="Save"
      secondaryButtonText="Cancel"
      primaryButtonDisabled={saving}
      loadingStatus={saving ? 'active' : 'inactive'}
      loadingDescription="Saving..."
    >
      <p className="modal-form__helper mail-categories__hint">
        Gmail sorts your inbox into these categories. Primary is always shown; choose which other tabs to show.
      </p>
      <fieldset className="cds--fieldset">
        {OPTIONAL_MAIL_CATEGORIES.map((category) => (
          <Checkbox
            key={category}
            id={`mail-category-${category}`}
            labelText={MAIL_CATEGORY_LABELS[category]}
            checked={tabs.includes(category)}
            onChange={(_e: React.ChangeEvent<HTMLInputElement>, { checked }: { checked: boolean }) => toggle(category, checked)}
          />
        ))}
      </fieldset>
    </Modal>
  );
}
