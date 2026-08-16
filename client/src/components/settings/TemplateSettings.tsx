import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  InlineLoading,
  Modal,
  RadioButton,
  RadioButtonGroup,
  Stack,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  Tag,
  TextInput,
  Tile,
} from '@carbon/react';
import { Tearsheet } from '@carbon/ibm-products';
import { Add, Edit, Email, TrashCan } from '@carbon/icons-react';
import type { Editor } from '@tiptap/react';
import { templatesApi } from '../../api/templates';
import { useUIStore } from '../../store/uiStore';
import { TiptapEditor } from '../mail/TiptapEditor';
import type { EmailTemplate, TemplateKind, TemplateVariable } from '../../types/template';

/** The JSON error envelope the API's errorHandler returns. */
interface ApiErrorLike {
  response?: { data?: { error?: { message?: string } } };
}

function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as ApiErrorLike | null | undefined)?.response?.data?.error?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

/**
 * Manage the reusable bodies that the compose window's picker offers.
 *
 * The variable list is fetched rather than hardcoded: the server rejects any
 * `{{placeholder}}` outside its own catalogue, so a list that drifted from it
 * here would be actively misleading — it would advertise variables that make
 * saving fail.
 */
export function TemplateSettings() {
  const addNotification = useUIStore((s) => s.addNotification);
  const bodyEditorRef = useRef<Editor | null>(null);

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [loading, setLoading] = useState(true);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TemplateKind>('template');
  const [subject, setSubject] = useState('');
  /** Seeds the editor on open; the live value is read off the Tiptap instance. */
  const [initialBody, setInitialBody] = useState('');
  const [saving, setSaving] = useState(false);

  const [toDelete, setToDelete] = useState<EmailTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const { data } = await templatesApi.getAll();
      setTemplates(data.data);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load templates' });
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => {
    void fetchTemplates();
    templatesApi
      .getVariables()
      .then(({ data }) => setVariables(data.data))
      .catch(() => setVariables([]));
  }, [fetchTemplates]);

  const openEditor = (template: EmailTemplate | null, newKind: TemplateKind = 'template') => {
    setEditing(template);
    setName(template?.name ?? '');
    setKind(template ? (template.kind as TemplateKind) : newKind);
    setSubject(template?.subject ?? '');
    setInitialBody(template?.body ?? '');
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
    bodyEditorRef.current = null;
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const body = bodyEditorRef.current?.getHTML() ?? '';
    if (!body || body === '<p></p>') {
      addNotification({ kind: 'warning', title: 'Write something to save' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: trimmedName,
        kind,
        // A snippet has no subject; sending null clears one left behind by a
        // template that was converted into a snippet.
        subject: kind === 'template' ? subject.trim() || null : null,
        body,
      };
      if (editing) {
        await templatesApi.update(editing.id, payload);
      } else {
        await templatesApi.create(payload);
      }
      addNotification({ kind: 'success', title: editing ? 'Template saved' : 'Template created' });
      closeEditor();
      await fetchTemplates();
    } catch (err) {
      // The server's message names the offending variable, which is the whole
      // value of the 400 — swallowing it would leave the user guessing.
      addNotification({ kind: 'error', title: apiErrorMessage(err, 'Failed to save template') });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template: EmailTemplate) => {
    setDeleting(true);
    try {
      await templatesApi.remove(template.id);
      addNotification({ kind: 'success', title: `Deleted "${template.name}"` });
      setToDelete(null);
      await fetchTemplates();
    } catch (err) {
      addNotification({ kind: 'error', title: apiErrorMessage(err, 'Failed to delete template') });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Tile className="settings-tile">
        <Stack gap={5}>
          <div className="settings-tile__header">
            <Email size={24} />
            <div>
              <h4 className="settings-tile__title">Email Templates</h4>
              <p className="settings-tile__subtitle">
                Reusable replies you can drop into a message. A <strong>template</strong> carries a subject and a
                body; a <strong>snippet</strong> is a fragment inserted wherever your cursor is.
              </p>
            </div>
          </div>

          {loading ? (
            <InlineLoading description="Loading templates..." />
          ) : templates.length === 0 ? (
            <p className="settings-tile__desc">
              Nothing saved yet. The next time you write the same reply twice, save it here.
            </p>
          ) : (
            <StructuredListWrapper isCondensed>
              <StructuredListHead>
                <StructuredListRow head>
                  <StructuredListCell head>Name</StructuredListCell>
                  <StructuredListCell head>Type</StructuredListCell>
                  <StructuredListCell head>Subject</StructuredListCell>
                  <StructuredListCell head>Used</StructuredListCell>
                  <StructuredListCell head>{''}</StructuredListCell>
                </StructuredListRow>
              </StructuredListHead>
              <StructuredListBody>
                {templates.map((t) => (
                  <StructuredListRow key={t.id}>
                    <StructuredListCell>{t.name}</StructuredListCell>
                    <StructuredListCell>
                      <Tag size="sm" type={t.kind === 'snippet' ? 'teal' : 'blue'}>
                        {t.kind === 'snippet' ? 'Snippet' : 'Template'}
                      </Tag>
                    </StructuredListCell>
                    <StructuredListCell>
                      <span className="templates-settings__subject">{t.subject || '—'}</span>
                    </StructuredListCell>
                    <StructuredListCell>{t.usageCount}</StructuredListCell>
                    <StructuredListCell>
                      <div className="templates-settings__row-actions">
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          iconDescription={`Edit "${t.name}"`}
                          renderIcon={Edit}
                          onClick={() => openEditor(t)}
                        />
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          iconDescription={`Delete "${t.name}"`}
                          renderIcon={TrashCan}
                          onClick={() => setToDelete(t)}
                        />
                      </div>
                    </StructuredListCell>
                  </StructuredListRow>
                ))}
              </StructuredListBody>
            </StructuredListWrapper>
          )}

          <div className="templates-settings__add">
            <Button kind="primary" size="sm" renderIcon={Add} onClick={() => openEditor(null, 'template')}>
              New template
            </Button>
            <Button kind="tertiary" size="sm" renderIcon={Add} onClick={() => openEditor(null, 'snippet')}>
              New snippet
            </Button>
          </div>

          {variables.length > 0 && (
            <div className="templates-settings__variables">
              <p className="settings-tile__desc">
                Placeholders you can use. Anything else is rejected when you save — a variable this app cannot fill
                would otherwise reach a customer as literal text.
              </p>
              <dl className="templates-settings__variable-list">
                {variables.map((v) => (
                  <div key={v.name} className="templates-settings__variable">
                    <dt>
                      <code>{`{{${v.name}}}`}</code> {v.label}
                    </dt>
                    <dd>{v.source}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Stack>
      </Tile>

      <Tearsheet
        open={editorOpen}
        onClose={closeEditor}
        title={editing ? `Edit "${editing.name}"` : kind === 'snippet' ? 'New snippet' : 'New template'}
        label="Email Templates"
        description={
          kind === 'snippet'
            ? 'A fragment inserted at your cursor — a sign-off, a booking link, a standard caveat.'
            : 'A whole message. Its subject is only used when the compose window has an empty one.'
        }
        hasCloseIcon
        selectorPrimaryFocus="#template-name"
        actions={[
          {
            key: 'save',
            label: saving ? 'Saving...' : 'Save',
            onClick: handleSave,
            kind: 'primary' as const,
            disabled: !name.trim() || saving,
            loading: saving,
          },
          {
            key: 'cancel',
            label: 'Cancel',
            onClick: closeEditor,
            kind: 'secondary' as const,
          },
        ]}
      >
        <div className="templates-editor">
          <TextInput
            id="template-name"
            labelText="Name"
            placeholder="e.g. Pricing follow-up"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            className="tearsheet-form__item"
          />

          <RadioButtonGroup
            legendText="Type"
            name="template-kind"
            valueSelected={kind}
            onChange={(value: unknown) => setKind(value === 'snippet' ? 'snippet' : 'template')}
            className="tearsheet-form__item"
          >
            <RadioButton labelText="Template (subject + body)" value="template" id="template-kind-template" />
            <RadioButton labelText="Snippet (body fragment)" value="snippet" id="template-kind-snippet" />
          </RadioButtonGroup>

          {kind === 'template' && (
            <TextInput
              id="template-subject"
              labelText="Subject"
              helperText="Used only when the message you are writing has no subject yet — a reply keeps its own."
              placeholder="e.g. Following up on your quote"
              value={subject}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value)}
              className="tearsheet-form__item"
            />
          )}

          <div className="tearsheet-form__item">
            <span className="cds--label">Body</span>
            <div className="templates-editor__body">
              {/*
                Remounted per template: Tiptap takes its content once at
                construction, so without a fresh key the second template opened
                would show the first one's body.
              */}
              <TiptapEditor
                key={editing?.id ?? `new-${editorOpen}`}
                content={initialBody}
                editorRef={bodyEditorRef}
                placeholder="Write the body. Use {{firstName}} and friends for the parts that change."
              />
            </div>
          </div>
        </div>
      </Tearsheet>

      <Modal
        open={toDelete !== null}
        danger
        modalHeading={toDelete ? `Delete "${toDelete.name}"?` : 'Delete template'}
        primaryButtonText={deleting ? 'Deleting...' : 'Delete'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={deleting}
        onRequestClose={() => setToDelete(null)}
        onRequestSubmit={() => { if (toDelete) void handleDelete(toDelete); }}
      >
        <p>
          The body is stored here and nowhere else, so deleting it is permanent. Messages you already sent using it
          are unaffected.
        </p>
      </Modal>
    </>
  );
}
