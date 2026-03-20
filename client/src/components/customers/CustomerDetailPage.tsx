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
  OverflowMenu,
  OverflowMenuItem,
  Tag,
  SkeletonText,
  TextInput,
  TextArea,
  Modal,
} from '@carbon/react';
import { Add, Edit, UserMultiple, TaskComplete, Calendar, Email, Attachment } from '@carbon/icons-react';
import { PageHeader } from '../shared/PageHeader';
import { SidePanel } from '@carbon/ibm-products';
import { format } from 'date-fns';
import { ContactModal } from './ContactModal';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { TaskStatusTag } from '../shared/TaskStatusTag';
import { PriorityBadge } from '../shared/PriorityBadge';
import { EmptyState } from '../shared/EmptyState';
import { AttachmentTable } from '../shared/AttachmentTable';
import { ThreadDetail } from '../mail/ThreadDetail';
import { customersApi, contactsApi } from '../../api/customers';
import { tasksApi } from '../../api/tasks';
import { emailsApi } from '../../api/emails';
import { useUIStore } from '../../store/uiStore';
import type { Customer, Contact } from '../../types/customer';
import type { Task } from '../../types/task';
import type { CalendarEvent } from '../../types/calendar';
import type { EmailThread, AttachmentWithEmail } from '../../types/email';

const contactHeaders = [
  { key: 'name', header: 'Name' },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'role', header: 'Role' },
  { key: 'actions', header: '' },
];

const taskHeaders = [
  { key: 'title', header: 'Title' },
  { key: 'status', header: 'Status' },
  { key: 'priority', header: 'Priority' },
  { key: 'dueDate', header: 'Due Date' },
];

const eventHeaders = [
  { key: 'title', header: 'Title' },
  { key: 'date', header: 'Date' },
  { key: 'location', header: 'Location' },
];

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [emailThreads, setEmailThreads] = useState<EmailThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<{ id: string; subject: string } | null>(null);
  const [attachments, setAttachments] = useState<AttachmentWithEmail[]>([]);
  const [loading, setLoading] = useState(true);

  // Table search/pagination state
  const [contactSearch, setContactSearch] = useState('');
  const [contactPage, setContactPage] = useState(1);
  const [contactPageSize, setContactPageSize] = useState(20);
  const [taskSearch, setTaskSearch] = useState('');
  const [taskPage, setTaskPage] = useState(1);
  const [taskPageSize, setTaskPageSize] = useState(20);
  const [eventSearch, setEventSearch] = useState('');
  const [eventPage, setEventPage] = useState(1);
  const [eventPageSize, setEventPageSize] = useState(20);
  const [emailSearch, setEmailSearch] = useState('');
  const [emailPage, setEmailPage] = useState(1);
  const [emailPageSize, setEmailPageSize] = useState(20);

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);

  // Edit customer state
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editWebsite, setEditWebsite] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [customerRes, tasksRes, eventsRes] = await Promise.all([
        customersApi.getById(id),
        tasksApi.getAll({ customerId: id, limit: '100' }),
        customersApi.getLinkedEvents(id),
      ]);
      const c = customerRes.data.data;
      setCustomer(c);
      setContacts(c.contacts || []);
      setTasks(tasksRes.data.data);
      setEvents(eventsRes.data.data);
      // Fetch email threads and attachments for this customer
      emailsApi.getThreads({ customerId: id!, limit: '20' })
        .then(({ data: res }) => setEmailThreads(res.data))
        .catch(() => {});
      customersApi.getAttachments(id!)
        .then(({ data: res }) => setAttachments(res.data))
        .catch(() => {});
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load customer' });
    } finally {
      setLoading(false);
    }
  }, [id, addNotification]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDeleteContact = async () => {
    if (!deleteContact) return;
    try {
      await contactsApi.delete(deleteContact.id);
      addNotification({ kind: 'success', title: 'Contact deleted' });
      setDeleteContact(null);
      fetchData();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete contact' });
    }
  };

  const openEditCustomer = () => {
    if (!customer) return;
    setEditName(customer.name);
    setEditCompany(customer.company || '');
    setEditEmail(customer.email || '');
    setEditPhone(customer.phone || '');
    setEditWebsite(customer.website || '');
    setEditNotes(customer.notes || '');
    setEditOpen(true);
  };

  const handleUpdateCustomer = async () => {
    if (!customer || !editName.trim()) return;
    try {
      await customersApi.update(customer.id, {
        name: editName.trim(),
        company: editCompany.trim() || undefined,
        email: editEmail.trim() || undefined,
        phone: editPhone.trim() || undefined,
        website: editWebsite.trim() || undefined,
        notes: editNotes.trim() || undefined,
      });
      addNotification({ kind: 'success', title: 'Customer updated' });
      setEditOpen(false);
      fetchData();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to update customer' });
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

  if (!customer) {
    return <EmptyState title="Customer not found" />;
  }

  return (
    <div>
      <PageHeader
        title={customer?.name || 'Customer'}
        breadcrumbs={[{ label: 'Customers', href: '/customers' }]}
      />

      <Grid fullWidth>
        <Column lg={16} md={8} sm={4} className="row-spacing">
          <Tile>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  {customer.logoUrl && (
                    <img
                      src={customer.logoUrl}
                      alt=""
                      className="customer-logo customer-logo--lg"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <h2 style={{ margin: 0 }}>{customer.name}</h2>
                </div>
                {customer.company && (
                  <p style={{ margin: '0 0 0.25rem', color: 'var(--cds-text-secondary)' }}>
                    {customer.company}
                  </p>
                )}
                <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                  {customer.domain && <Tag type="cool-gray" size="sm">{customer.domain}</Tag>}
                  {customer.email && <span>{customer.email}</span>}
                  {customer.phone && <span>{customer.phone}</span>}
                  {customer.website && <span>{customer.website}</span>}
                </div>
                {customer.notes && (
                  <p style={{ marginTop: '0.75rem', color: 'var(--cds-text-secondary)', fontSize: '0.875rem' }}>
                    {customer.notes}
                  </p>
                )}
              </div>
              <Button kind="ghost" size="sm" renderIcon={Edit} onClick={openEditCustomer}>
                Edit
              </Button>
            </div>
          </Tile>
        </Column>

        <Column lg={16} md={8} sm={4}>
          <Tabs>
            <TabList aria-label="Customer details">
              <Tab renderIcon={UserMultiple}>Contacts ({contacts.length})</Tab>
              <Tab renderIcon={TaskComplete}>Tasks ({tasks.length})</Tab>
              <Tab renderIcon={Calendar}>Events ({events.length})</Tab>
              <Tab renderIcon={Email}>Emails ({emailThreads.length})</Tab>
              <Tab renderIcon={Attachment}>Attachments ({attachments.length})</Tab>
            </TabList>
            <TabPanels>
              {/* ─── Contacts Tab ─── */}
              <TabPanel>
                <div style={{ marginBottom: '1rem' }}>
                  <Button size="sm" renderIcon={Add} onClick={() => { setEditContact(null); setContactModalOpen(true); }}>Add Contact</Button>
                </div>
                {contacts.length === 0 ? (
                  <EmptyState title="No contacts" description="Add contacts to this customer" icon={<UserMultiple size={48} />} />
                ) : (() => {
                  const q = contactSearch.toLowerCase();
                  const filtered = q ? contacts.filter((c) => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (c.role || '').toLowerCase().includes(q)) : contacts;
                  const paginated = filtered.slice((contactPage - 1) * contactPageSize, contactPage * contactPageSize);
                  const rows = paginated.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, email: c.email || '—', phone: c.phone || '—', role: c.role || '—' }));
                  return (<>
                    <DataTable rows={rows} headers={contactHeaders} isSortable>
                      {({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps }) => (
                        <TableContainer>
                          <TableToolbar><TableToolbarContent><TableToolbarSearch placeholder="Search contacts..." onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setContactSearch(e.target.value); setContactPage(1); }} persistent /></TableToolbarContent></TableToolbar>
                          <Table {...getTableProps()} size="lg">
                            <TableHead><TableRow>{tableHeaders.map((h) => <TableHeader {...getHeaderProps({ header: h })} key={h.key} isSortable={h.key !== 'actions'}>{h.header}</TableHeader>)}</TableRow></TableHead>
                            <TableBody>
                              {paginated.map((contact, i) => {
                                const row = tableRows[i]; if (!row) return null;
                                return (<TableRow {...getRowProps({ row })} key={row.id}>
                                  <TableCell>{contact.firstName} {contact.lastName}</TableCell>
                                  <TableCell>{contact.email || '—'}</TableCell>
                                  <TableCell>{contact.phone || '—'}</TableCell>
                                  <TableCell>{contact.role || '—'}</TableCell>
                                  <TableCell>
                                    <OverflowMenu flipped size="sm" aria-label="Actions">
                                      <OverflowMenuItem itemText="Edit" onClick={() => { setEditContact(contact); setContactModalOpen(true); }} />
                                      <OverflowMenuItem itemText="Delete" isDelete onClick={() => setDeleteContact(contact)} />
                                    </OverflowMenu>
                                  </TableCell>
                                </TableRow>);
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </DataTable>
                    {filtered.length > 10 && <Pagination totalItems={filtered.length} pageSize={contactPageSize} pageSizes={[10, 20, 50]} page={contactPage} onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => { setContactPage(p); setContactPageSize(ps); }} />}
                  </>);
                })()}
              </TabPanel>

              {/* ─── Tasks Tab ─── */}
              <TabPanel>
                {tasks.length === 0 ? (
                  <EmptyState title="No linked tasks" description="Link tasks to this customer from the Tasks page" icon={<TaskComplete size={48} />} />
                ) : (() => {
                  const q = taskSearch.toLowerCase();
                  const filtered = q ? tasks.filter((t) => t.title.toLowerCase().includes(q) || t.status.toLowerCase().includes(q)) : tasks;
                  const paginated = filtered.slice((taskPage - 1) * taskPageSize, taskPage * taskPageSize);
                  const rows = paginated.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate || '' }));
                  return (<>
                    <DataTable rows={rows} headers={taskHeaders} isSortable>
                      {({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps }) => (
                        <TableContainer>
                          <TableToolbar><TableToolbarContent><TableToolbarSearch placeholder="Search tasks..." onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setTaskSearch(e.target.value); setTaskPage(1); }} persistent /></TableToolbarContent></TableToolbar>
                          <Table {...getTableProps()} size="lg">
                            <TableHead><TableRow>{tableHeaders.map((h) => <TableHeader {...getHeaderProps({ header: h })} key={h.key}>{h.header}</TableHeader>)}</TableRow></TableHead>
                            <TableBody>
                              {paginated.map((task, i) => {
                                const row = tableRows[i]; if (!row) return null;
                                return (<TableRow {...getRowProps({ row })} key={row.id}>
                                  <TableCell><span style={{ cursor: 'pointer', fontWeight: 500 }} onClick={() => navigate('/tasks')}>{task.title}</span></TableCell>
                                  <TableCell><TaskStatusTag status={task.status} /></TableCell>
                                  <TableCell><PriorityBadge priority={task.priority} /></TableCell>
                                  <TableCell>{task.dueDate ? format(new Date(task.dueDate), 'MMM d, yyyy') : '—'}</TableCell>
                                </TableRow>);
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </DataTable>
                    {filtered.length > 10 && <Pagination totalItems={filtered.length} pageSize={taskPageSize} pageSizes={[10, 20, 50]} page={taskPage} onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => { setTaskPage(p); setTaskPageSize(ps); }} />}
                  </>);
                })()}
              </TabPanel>

              {/* ─── Events Tab ─── */}
              <TabPanel>
                {events.length === 0 ? (
                  <EmptyState title="No linked events" description="Events will appear here after syncing your calendar" icon={<Calendar size={48} />} />
                ) : (() => {
                  const q = eventSearch.toLowerCase();
                  const filtered = q ? events.filter((e) => e.title.toLowerCase().includes(q) || (e.location || '').toLowerCase().includes(q)) : events;
                  const paginated = filtered.slice((eventPage - 1) * eventPageSize, eventPage * eventPageSize);
                  const rows = paginated.map((e) => ({ id: e.id, title: e.title, date: format(new Date(e.startTime), 'MMM d, yyyy · h:mm a'), location: e.location || '—' }));
                  return (<>
                    <DataTable rows={rows} headers={eventHeaders} isSortable>
                      {({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps }) => (
                        <TableContainer>
                          <TableToolbar><TableToolbarContent><TableToolbarSearch placeholder="Search events..." onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setEventSearch(e.target.value); setEventPage(1); }} persistent /></TableToolbarContent></TableToolbar>
                          <Table {...getTableProps()} size="lg">
                            <TableHead><TableRow>{tableHeaders.map((h) => <TableHeader {...getHeaderProps({ header: h })} key={h.key}>{h.header}</TableHeader>)}</TableRow></TableHead>
                            <TableBody>
                              {paginated.map((evt, i) => {
                                const row = tableRows[i]; if (!row) return null;
                                return (<TableRow {...getRowProps({ row })} key={row.id}>
                                  <TableCell><span style={{ cursor: 'pointer', fontWeight: 500 }} onClick={() => navigate('/calendar')}>{evt.title}</span></TableCell>
                                  <TableCell>{format(new Date(evt.startTime), 'MMM d, yyyy · h:mm a')}</TableCell>
                                  <TableCell>{evt.location || '—'}</TableCell>
                                </TableRow>);
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </DataTable>
                    {filtered.length > 10 && <Pagination totalItems={filtered.length} pageSize={eventPageSize} pageSizes={[10, 20, 50]} page={eventPage} onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => { setEventPage(p); setEventPageSize(ps); }} />}
                  </>);
                })()}
              </TabPanel>

              {/* ─── Emails Tab ─── */}
              <TabPanel>
                {emailThreads.length === 0 ? (
                  <EmptyState title="No emails" description="Emails will appear here after syncing Gmail" icon={<Email size={48} />} />
                ) : (() => {
                  const q = emailSearch.toLowerCase();
                  const filtered = q ? emailThreads.filter((t) => t.latestEmail.subject.toLowerCase().includes(q) || (t.latestEmail.fromName || t.latestEmail.from).toLowerCase().includes(q)) : emailThreads;
                  const paginated = filtered.slice((emailPage - 1) * emailPageSize, emailPage * emailPageSize);
                  const emailHeaders = [{ key: 'subject', header: 'Subject' }, { key: 'from', header: 'From' }, { key: 'date', header: 'Date' }, { key: 'messages', header: 'Messages' }];
                  const rows = paginated.map((t) => ({ id: t.threadId || t.latestEmail.id, subject: t.latestEmail.subject, from: t.latestEmail.fromName || t.latestEmail.from, date: format(new Date(t.latestEmail.receivedAt), 'MMM d, yyyy'), messages: String(t.messageCount) }));
                  return (<>
                    <DataTable rows={rows} headers={emailHeaders} isSortable>
                      {({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps }) => (
                        <TableContainer>
                          <TableToolbar><TableToolbarContent><TableToolbarSearch placeholder="Search emails..." onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setEmailSearch(e.target.value); setEmailPage(1); }} persistent /></TableToolbarContent></TableToolbar>
                          <Table {...getTableProps()} size="lg">
                            <TableHead><TableRow>{tableHeaders.map((h) => <TableHeader {...getHeaderProps({ header: h })} key={h.key}>{h.header}</TableHeader>)}</TableRow></TableHead>
                            <TableBody>
                              {tableRows.map((row) => (
                                <TableRow {...getRowProps({ row })} key={row.id}>
                                  {row.cells.map((cell) => (
                                    <TableCell key={cell.id}>
                                      {cell.info.header === 'subject' ? <span style={{ cursor: 'pointer', fontWeight: 500 }} onClick={() => setSelectedThread({ id: row.id, subject: cell.value })}>{cell.value}</span>
                                        : cell.info.header === 'messages' ? <Tag type="cool-gray" size="sm">{cell.value}</Tag>
                                        : cell.value}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </DataTable>
                    {filtered.length > 10 && <Pagination totalItems={filtered.length} pageSize={emailPageSize} pageSizes={[10, 20, 50]} page={emailPage} onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => { setEmailPage(p); setEmailPageSize(ps); }} />}
                  </>);
                })()}
              </TabPanel>
              <TabPanel>
                <AttachmentTable
                  attachments={attachments}
                  emptyDescription="Attachments from emails linked to this customer will appear here"
                />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </Column>
      </Grid>

      <ContactModal
        open={contactModalOpen}
        contact={editContact}
        customerId={customer.id}
        onClose={() => { setContactModalOpen(false); setEditContact(null); }}
        onSaved={fetchData}
      />

      <ConfirmDeleteModal
        open={!!deleteContact}
        title={deleteContact ? `${deleteContact.firstName} ${deleteContact.lastName}` : ''}
        onClose={() => setDeleteContact(null)}
        onConfirm={handleDeleteContact}
      />

      <Modal
        open={editOpen}
        onRequestClose={() => setEditOpen(false)}
        onRequestSubmit={handleUpdateCustomer}
        modalHeading="Edit Customer"
        primaryButtonText="Save"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!editName.trim()}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <TextInput id="edit-cust-name" labelText="Name" value={editName} onChange={(e) => setEditName(e.target.value)} required />
          <TextInput id="edit-cust-company" labelText="Company" value={editCompany} onChange={(e) => setEditCompany(e.target.value)} />
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}><TextInput id="edit-cust-email" labelText="Email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} /></div>
            <div style={{ flex: 1 }}><TextInput id="edit-cust-phone" labelText="Phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} /></div>
          </div>
          <TextInput id="edit-cust-website" labelText="Website" value={editWebsite} onChange={(e) => setEditWebsite(e.target.value)} />
          <TextArea id="edit-cust-notes" labelText="Notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
        </div>
      </Modal>

      <SidePanel
        open={!!selectedThread}
        onRequestClose={() => setSelectedThread(null)}
        title={selectedThread?.subject || 'Thread'}
        size="lg"
        slideIn
        selectorPageContent=".app-content"
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
