import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Grid,
  Column,
  Tile,
  Button,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Pagination,
  Tag,
  SkeletonText,
  TextInput,
  Modal,
  InlineLoading,
} from '@carbon/react';
import { Edit, Calendar, Email, Enterprise, Attachment } from '@carbon/icons-react';
import { VipBadge } from '../shared/VipBadge';
import { PageHeader } from '../shared/PageHeader';
import { SidePanel } from '@carbon/ibm-products';
import { format } from 'date-fns';
import { EmptyState } from '../shared/EmptyState';
import { AttachmentTable } from '../shared/AttachmentTable';
import { ThreadDetail } from '../mail/ThreadDetail';
import { contactsApi } from '../../api/customers';
import { emailsApi } from '../../api/emails';
import { useUIStore } from '../../store/uiStore';
import type { Contact } from '../../types/customer';
import type { CalendarEvent } from '../../types/calendar';
import type { EmailThread, AttachmentWithEmail } from '../../types/email';
import { ThreadItemList } from '../shared/ThreadItemList';

const eventHeaders = [
  { key: 'title', header: 'Title' },
  { key: 'date', header: 'Date' },
  { key: 'location', header: 'Location' },
  { key: 'attendees', header: 'Attendees' },
];

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);

  const [contact, setContact] = useState<Contact | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [emailThreads, setEmailThreads] = useState<EmailThread[]>([]);
  const [emailTotal, setEmailTotal] = useState(0);
  const [selectedThread, setSelectedThread] = useState<{ id: string; subject: string } | null>(null);
  const [attachments, setAttachments] = useState<AttachmentWithEmail[]>([]);
  const [loading, setLoading] = useState(true);

  // Table search/pagination state
  const [eventSearch, setEventSearch] = useState('');
  const [eventPage, setEventPage] = useState(1);
  const [eventPageSize, setEventPageSize] = useState(20);
  const [emailSearch, setEmailSearch] = useState('');
  const [emailPage, setEmailPage] = useState(1);
  const [emailPageSize, setEmailPageSize] = useState(20);
  const [emailLoading, setEmailLoading] = useState(false);

  // Edit contact state
  const [editOpen, setEditOpen] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState('');

  const fetchEmails = useCallback(async (contactEmail: string, page: number, pageSize: number, search?: string) => {
    setEmailLoading(true);
    try {
      const params: Record<string, string> = {
        contactEmail,
        limit: String(pageSize),
        page: String(page),
      };
      if (search) params.search = search;
      const { data: res } = await emailsApi.getThreads(params);
      setEmailThreads(res.data);
      setEmailTotal(res.meta?.total || res.data.length);
    } catch {
      // ignore
    } finally {
      setEmailLoading(false);
    }
  }, []);

  const handleThreadAction = useCallback(async (action: string, thread: { threadId: string | null; latestEmail: { id: string; isStarred: boolean; isRead: boolean; isTrashed: boolean } }) => {
    const emailId = thread.latestEmail.id;
    try {
      if (action === 'star') await emailsApi.toggleStar(emailId);
      else if (action === 'trash') await (thread.latestEmail.isTrashed ? emailsApi.untrash(emailId) : emailsApi.trash(emailId));
      else if (action === 'readToggle') await (thread.latestEmail.isRead ? emailsApi.markAsUnread(emailId) : emailsApi.markAsRead(emailId));
      if (contact?.email) fetchEmails(contact.email, emailPage, emailPageSize, emailSearch || undefined);
    } catch { addNotification({ kind: 'error', title: 'Action failed' }); }
  }, [contact, emailPage, emailPageSize, emailSearch, addNotification, fetchEmails]);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [contactRes, eventsRes] = await Promise.all([
        contactsApi.getById(id),
        contactsApi.getEvents(id),
      ]);
      setContact(contactRes.data.data);
      setEvents(eventsRes.data.data);
      // Fetch emails for this contact (first page)
      if (contactRes.data.data.email) {
        fetchEmails(contactRes.data.data.email, 1, emailPageSize);
      }
      contactsApi.getAttachments(id!)
        .then(({ data: res }) => setAttachments(res.data))
        .catch(() => {});
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load contact' });
    } finally {
      setLoading(false);
    }
  }, [id, addNotification, fetchEmails, emailPageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openEditContact = () => {
    if (!contact) return;
    setEditFirstName(contact.firstName);
    setEditLastName(contact.lastName);
    setEditEmail(contact.email || '');
    setEditPhone(contact.phone || '');
    setEditRole(contact.role || '');
    setEditOpen(true);
  };

  const handleUpdateContact = async () => {
    if (!contact || !editFirstName.trim() || !editLastName.trim()) return;
    try {
      await contactsApi.update(contact.id, {
        firstName: editFirstName.trim(),
        lastName: editLastName.trim(),
        email: editEmail.trim() || undefined,
        phone: editPhone.trim() || undefined,
        role: editRole.trim() || undefined,
      });
      addNotification({ kind: 'success', title: 'Contact updated' });
      setEditOpen(false);
      fetchData();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to update contact' });
    }
  };

  if (loading) {
    return (
      <Grid fullWidth>
        <Column lg={16} md={8} sm={4}>
          <SkeletonText heading width="40%" />
          <SkeletonText paragraph lineCount={3} />
        </Column>
      </Grid>
    );
  }

  if (!contact) {
    return <EmptyState title="Contact not found" />;
  }

  return (
    <div>
      <PageHeader
        title={contact ? `${contact.firstName} ${contact.lastName}` : 'Contact'}
        breadcrumbs={[{ label: 'Contacts', href: '/contacts' }]}
      />

      <Grid fullWidth>
        <Column lg={16} md={8} sm={4} className="row-spacing">
          <Tile>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  {contact.customer?.logoUrl && (
                    <img
                      src={contact.customer.logoUrl}
                      alt=""
                      className="customer-logo customer-logo--lg"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <h2 style={{ margin: 0 }}>{contact.firstName} {contact.lastName}</h2>
                  <VipBadge
                    isVip={contact.isVip}
                    size={20}
                    onToggle={async () => {
                      try {
                        const { data: res } = await contactsApi.toggleVip(contact.id);
                        setContact(res.data);
                      } catch {
                        addNotification({ kind: 'error', title: 'Failed to toggle VIP status' });
                      }
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {contact.customer && (
                    <Tag
                      type="cyan"
                      size="sm"
                      renderIcon={Enterprise}
                      className="clickable-tag"
                      onClick={() => navigate(`/customers/${contact.customer!.id}`)}
                    >
                      {contact.customer.name}
                    </Tag>
                  )}
                  {contact.role && <Tag type="purple" size="sm">{contact.role}</Tag>}
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem', flexWrap: 'wrap', color: 'var(--cds-text-secondary)' }}>
                  {contact.email && <span>{contact.email}</span>}
                  {contact.phone && <span>{contact.phone}</span>}
                </div>
              </div>
              <Button kind="ghost" size="sm" renderIcon={Edit} onClick={openEditContact}>
                Edit
              </Button>
            </div>
          </Tile>
        </Column>

        <Column lg={16} md={8} sm={4}>
          <Tabs>
            <TabList aria-label="Contact details">
              <Tab renderIcon={Calendar}>Events ({events.length})</Tab>
              <Tab renderIcon={Email}>Emails ({emailTotal})</Tab>
              <Tab renderIcon={Attachment}>Attachments ({attachments.length})</Tab>
            </TabList>
            <TabPanels>
              <TabPanel>
                {events.length === 0 ? (
                  <EmptyState title="No linked events" description="Events where this contact is an attendee will appear here" icon={<Calendar size={48} />} />
                ) : (() => {
                  const filteredEvents = eventSearch
                    ? events.filter((e) => e.title.toLowerCase().includes(eventSearch.toLowerCase()) || (e.location || '').toLowerCase().includes(eventSearch.toLowerCase()))
                    : events;
                  const paginatedEvents = filteredEvents.slice((eventPage - 1) * eventPageSize, eventPage * eventPageSize);
                  const rows = paginatedEvents.map((e) => ({
                    id: e.id,
                    title: e.title,
                    date: format(new Date(e.startTime), 'MMM d, yyyy · h:mm a'),
                    location: e.location || '—',
                    attendees: String((e.attendees as unknown as Array<{ email: string }> | null)?.length ?? 0),
                  }));
                  return (
                    <>
                      <DataTable rows={rows} headers={eventHeaders} isSortable>
                        {({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps }) => (
                          <TableContainer>
                            <TableToolbar>
                              <TableToolbarContent>
                                <TableToolbarSearch placeholder="Search events..." onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setEventSearch(e.target.value); setEventPage(1); }} persistent />
                              </TableToolbarContent>
                            </TableToolbar>
                            <Table {...getTableProps()} size="lg">
                              <TableHead>
                                <TableRow>
                                  {tableHeaders.map((header) => (
                                    <TableHeader {...getHeaderProps({ header })} key={header.key}>{header.header}</TableHeader>
                                  ))}
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {tableRows.map((row) => {
                                  const evt = paginatedEvents.find((e) => e.id === row.id)!;
                                  const attendees = evt?.attendees as unknown as Array<{ email: string }> | null;
                                  return (
                                    <TableRow {...getRowProps({ row })} key={row.id}>
                                      <TableCell>
                                        <span style={{ cursor: 'pointer', fontWeight: 500 }} onClick={() => navigate('/calendar')}>{evt?.title}</span>
                                      </TableCell>
                                      <TableCell>{format(new Date(evt?.startTime), 'MMM d, yyyy · h:mm a')}</TableCell>
                                      <TableCell>{evt?.location || '—'}</TableCell>
                                      <TableCell><Tag type="cool-gray" size="sm">{attendees?.length ?? 0}</Tag></TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        )}
                      </DataTable>
                      {filteredEvents.length > 10 && (
                        <Pagination totalItems={filteredEvents.length} pageSize={eventPageSize} pageSizes={[10, 20, 50]} page={eventPage}
                          onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => { setEventPage(p); setEventPageSize(ps); }}
                        />
                      )}
                    </>
                  );
                })()}
              </TabPanel>
              <TabPanel>
                {emailThreads.length === 0 && !emailLoading ? (
                  <EmptyState title="No emails" description="Emails involving this contact will appear here after syncing" icon={<Email size={48} />} />
                ) : (
                  <>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <TableToolbar><TableToolbarContent><TableToolbarSearch placeholder="Search emails..." onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setEmailSearch(e.target.value);
                        setEmailPage(1);
                        if (contact?.email) fetchEmails(contact.email, 1, emailPageSize, e.target.value || undefined);
                      }} persistent /></TableToolbarContent></TableToolbar>
                    </div>
                    <ThreadItemList
                      threads={emailThreads}
                      totalItems={emailTotal}
                      page={emailPage}
                      pageSize={emailPageSize}
                      onPageChange={(p, ps) => {
                        setEmailPage(p);
                        setEmailPageSize(ps);
                        if (contact?.email) fetchEmails(contact.email, p, ps, emailSearch || undefined);
                      }}
                      onThreadClick={(tid, subject) => setSelectedThread({ id: tid, subject })}
                      onThreadAction={handleThreadAction as any}
                      loading={emailLoading}
                    />
                    {emailLoading && <InlineLoading description="Loading emails..." />}
                  </>
                )}
              </TabPanel>
              <TabPanel>
                <AttachmentTable
                  attachments={attachments}
                  emptyDescription="Attachments from emails involving this contact will appear here"
                />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </Column>
      </Grid>

      <Modal
        open={editOpen}
        onRequestClose={() => setEditOpen(false)}
        onRequestSubmit={handleUpdateContact}
        modalHeading="Edit Contact"
        primaryButtonText="Save"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!editFirstName.trim() || !editLastName.trim()}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <TextInput id="edit-contact-fn" labelText="First name" value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} required />
            </div>
            <div style={{ flex: 1 }}>
              <TextInput id="edit-contact-ln" labelText="Last name" value={editLastName} onChange={(e) => setEditLastName(e.target.value)} required />
            </div>
          </div>
          <TextInput id="edit-contact-email" labelText="Email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <TextInput id="edit-contact-phone" labelText="Phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <TextInput id="edit-contact-role" labelText="Role" value={editRole} onChange={(e) => setEditRole(e.target.value)} />
            </div>
          </div>
        </div>
      </Modal>

      <SidePanel
        open={!!selectedThread}
        onRequestClose={() => setSelectedThread(null)}
        title={selectedThread?.subject || 'Thread'}
        size="lg"
        className="mail-page__side-panel"
      >
        {selectedThread && (
          <ThreadDetail
            threadId={selectedThread.id}
            onEmailAction={() => {}}
          />
        )}
      </SidePanel>
    </div>
  );
}
