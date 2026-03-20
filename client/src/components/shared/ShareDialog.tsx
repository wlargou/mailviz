import { useState, useEffect } from 'react';
import { Modal, TextInput, Button, Tag, InlineLoading } from '@carbon/react';
import { TrashCan, UserAvatar, Checkmark } from '@carbon/icons-react';
import { authApi } from '../../api/auth';

interface ShareUser {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

interface CurrentShare {
  id: string;
  createdAt: string;
  sharedWith: ShareUser;
}

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Current shares for this item */
  currentShares: CurrentShare[];
  /** Called when user confirms sharing */
  onShare: (userIds: string[]) => Promise<void>;
  /** Called when removing an existing share */
  onUnshare: (userId: string) => Promise<void>;
  /** Reload current shares after changes */
  onRefresh: () => void;
}

export function ShareDialog({
  open,
  onClose,
  title,
  currentShares,
  onShare,
  onUnshare,
  onRefresh,
}: ShareDialogProps) {
  const [users, setUsers] = useState<ShareUser[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);

  // Fetch available users
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    authApi.getUsers()
      .then(({ data: res }) => setUsers(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
    setSelectedIds(new Set());
    setSearch('');
  }, [open]);

  const alreadySharedIds = new Set(currentShares.map((s) => s.sharedWith.id));

  const filteredUsers = users.filter((u) => {
    if (alreadySharedIds.has(u.id)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (u.name?.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  });

  const toggleUser = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleShare = async () => {
    if (selectedIds.size === 0) return;
    setSharing(true);
    try {
      await onShare([...selectedIds]);
      setSelectedIds(new Set());
      onRefresh();
    } finally {
      setSharing(false);
    }
  };

  const handleUnshare = async (userId: string) => {
    await onUnshare(userId);
    onRefresh();
  };

  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      modalHeading={`Share: ${title}`}
      primaryButtonText={sharing ? 'Sharing...' : `Share with ${selectedIds.size} user${selectedIds.size !== 1 ? 's' : ''}`}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={selectedIds.size === 0 || sharing}
      onRequestSubmit={handleShare}
      size="sm"
    >
      <div className="share-dialog">
        <TextInput
          id="share-search"
          labelText="Search users"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="sm"
          className="share-dialog__search"
        />

        {loading ? (
          <InlineLoading description="Loading users..." />
        ) : (
          <div className="share-dialog__users">
            {filteredUsers.length === 0 ? (
              <div style={{ padding: '1rem', color: 'var(--cds-text-secondary)', fontSize: '0.875rem', textAlign: 'center' }}>
                {users.length === 0 ? 'No other users in the app' : 'No users match your search'}
              </div>
            ) : (
              filteredUsers.map((user) => (
                <div
                  key={user.id}
                  className={`share-dialog__user${selectedIds.has(user.id) ? ' share-dialog__user--selected' : ''}`}
                  onClick={() => toggleUser(user.id)}
                >
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="share-dialog__avatar" />
                  ) : (
                    <UserAvatar size={32} />
                  )}
                  <div className="share-dialog__user-info">
                    <div className="share-dialog__user-name">{user.name || user.email}</div>
                    {user.name && <div className="share-dialog__user-email">{user.email}</div>}
                  </div>
                  {selectedIds.has(user.id) && (
                    <Checkmark size={20} style={{ color: 'var(--cds-support-success)' }} />
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {currentShares.length > 0 && (
          <>
            <div className="share-dialog__divider">Currently shared with</div>
            <div className="share-dialog__current-shares">
              {currentShares.map((share) => (
                <div key={share.id} className="share-dialog__share-item">
                  <div className="share-dialog__share-info">
                    {share.sharedWith.avatarUrl ? (
                      <img src={share.sharedWith.avatarUrl} alt="" className="share-dialog__avatar" style={{ width: 24, height: 24 }} />
                    ) : (
                      <UserAvatar size={24} />
                    )}
                    <span style={{ fontSize: '0.875rem' }}>{share.sharedWith.name || share.sharedWith.email}</span>
                  </div>
                  <Button
                    kind="danger--ghost"
                    size="sm"
                    hasIconOnly
                    renderIcon={TrashCan}
                    iconDescription="Remove"
                    onClick={() => handleUnshare(share.sharedWith.id)}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
