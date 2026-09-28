import { ContentSwitcher, Switch, MenuButton, MenuItem, MenuItemDivider } from '@carbon/react';

/**
 * The folder bar: the four places mail is worked from, and the rest behind
 * "More".
 *
 * It used to be nine equal switches — All, Inbox, Sent, Drafts, Starred,
 * Archived, Trash, Snoozed, Scheduled — so the one that matters most, the
 * inbox, was one ninth of a strip and "who am I keeping waiting" was not a
 * place at all. A folder opened from More joins the switcher while it is
 * open, so the bar always says where you are and stays reachable by keyboard
 * (Carbon's switches only take focus when one of them is selected).
 */

/** `null` is All mail, as it is in `MailFilters.folder`. */
export type MailFolder = string | null;

export const PRIMARY_FOLDERS: { id: string; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'to-reply', label: 'To reply' },
  { id: 'sent', label: 'Sent' },
  { id: 'drafts', label: 'Drafts' },
];

export const MORE_FOLDERS: { id: MailFolder; label: string }[] = [
  { id: 'starred', label: 'Starred' },
  { id: 'snoozed', label: 'Snoozed' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'archived', label: 'Archived' },
  { id: 'trash', label: 'Trash' },
  { id: null, label: 'All mail' },
];

interface Props {
  folder: MailFolder;
  /** Threads waiting on a reply; shown beside "To reply" when there are any. */
  toReplyCount: number | null;
  onChange: (folder: MailFolder) => void;
}

export function MailFolderBar({ folder, toReplyCount, onChange }: Props) {
  const extra = MORE_FOLDERS.find((f) => f.id === folder);
  const switches: { id: MailFolder; label: string }[] = extra
    ? [...PRIMARY_FOLDERS, extra]
    : PRIMARY_FOLDERS;
  const selectedIndex = Math.max(0, switches.findIndex((f) => f.id === folder));

  const labelOf = (f: { id: MailFolder; label: string }) =>
    f.id === 'to-reply' && toReplyCount ? `${f.label} (${toReplyCount})` : f.label;

  return (
    <div className="mail-folder-bar">
      <ContentSwitcher
        size="sm"
        selectedIndex={selectedIndex}
        onChange={({ index }) => {
          // Carbon only fires onChange once it has resolved an index, but
          // `SwitchEventHandlersParams['index']` is optional.
          if (index === undefined) return;
          onChange(switches[index].id);
        }}
      >
        {switches.map((f) => (
          <Switch key={f.id ?? 'all'} name={f.id ?? 'all'} text={labelOf(f)} />
        ))}
      </ContentSwitcher>
      <MenuButton label="More" kind="ghost" size="sm" menuAlignment="bottom-end">
        {MORE_FOLDERS.flatMap((f) => [
          // All mail is not a folder like the others; set it apart.
          ...(f.id === null ? [<MenuItemDivider key="divider" />] : []),
          <MenuItem key={f.id ?? 'all'} label={f.label} onClick={() => onChange(f.id)} />,
        ])}
      </MenuButton>
    </div>
  );
}
