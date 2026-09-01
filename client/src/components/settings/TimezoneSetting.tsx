import { useMemo, useState } from 'react';
import { Button, ComboBox, InlineNotification } from '@carbon/react';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/authStore';

/**
 * Which timezone the server should compute this account's days in.
 *
 * The browser reports its zone on sign-in, so this exists for the cases
 * detection cannot cover: a laptop travelling, a machine with the wrong system
 * clock zone, or someone who works to a different office's calendar than the
 * one they are sitting in. Every day and week boundary the server computes —
 * "today" on the dashboard, meeting hours this week, the overdue badge — reads
 * this value.
 *
 * The list comes from `Intl.supportedValuesOf`, i.e. the runtime's own tz
 * database, rather than a checked-in list that would rot as IANA adds and
 * renames zones.
 */
export function TimezoneSetting() {
  const user = useAuthStore((s) => s.user);
  const fetchUser = useAuthStore((s) => s.fetchUser);

  const detected = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      // Older runtimes have no supportedValuesOf. Offering the two we know
      // beats offering an empty list the user cannot escape.
      return Array.from(new Set([detected, 'UTC']));
    }
  }, [detected]);

  // Null means "no zone stored", which the server reads as UTC.
  const current = user?.timezone ?? null;
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async (zone: string) => {
    if (!zone || zone === current) return;
    setSaving(true);
    setFailed(false);
    try {
      await authApi.updateTimezone(zone);
      // Refetch rather than patching locally: the server is the authority on
      // what it stored, and this value drives every boundary it computes.
      await fetchUser();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="timezone-setting">
      <ComboBox
        id="timezone-select"
        titleText="Timezone"
        helperText={
          current
            ? `Days, weeks and overdue dates are calculated in ${current}.`
            : `No timezone set, so dates are calculated in UTC. Your browser reports ${detected}.`
        }
        placeholder="Search timezones"
        items={zones}
        selectedItem={current}
        disabled={saving}
        onChange={({ selectedItem }) => {
          if (selectedItem) void save(selectedItem);
        }}
      />

      {current !== detected && (
        <Button
          kind="ghost"
          size="sm"
          disabled={saving}
          onClick={() => void save(detected)}
        >
          Use this browser&rsquo;s timezone ({detected})
        </Button>
      )}

      {failed && (
        <InlineNotification
          kind="error"
          lowContrast
          title="Could not save timezone"
          subtitle="Nothing was changed. Try again."
          onCloseButtonClick={() => setFailed(false)}
        />
      )}
    </div>
  );
}
