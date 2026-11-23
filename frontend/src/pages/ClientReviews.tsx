// Client reviews (testimonials): the OWNER's list, view and form. Every API call is OWNER only (403 for any other
// role); App.tsx also sends other roles away from these routes.
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { act, del, get, openFile, patch, post, qs } from '../api';
import { usePaged, type Page } from '../components';
import { fmtDate, fmtDateTime, fmtNumber } from '../format';
import { label, msg, useI18n } from '../i18n';
import {
  Alert, Badge, Button, ButtonLink, Card, confirmAction, cx, Dialog, EmptyState, Field, Icon, IconButton, Input, Loading,
  PageHeader, Person, SearchInput, Segmented, Select, StatusBadge, Switch, Table, Textarea, type IconName,
} from '../ui';
import { useLoad } from '../util';
import '../styles/areas/reviews.css';

// The backend's rules (client-reviews.constants.ts, file-type.util.ts); the server checks them again.
const TYPES = ['TEXT', 'IMAGE', 'GALLERY'] as const;
type ReviewType = (typeof TYPES)[number];
const TYPE_ICONS: Record<ReviewType, IconName> = { TEXT: 'message', IMAGE: 'image', GALLERY: 'layout' };
const NAME_MIN = 2;
const NAME_MAX = 120;
const CONTENT_MAX = 5000;
const KEYWORDS_MAX = 20;
const KEYWORD_MAX = 50;
const FILES_MAX = 10;
const FILE_MAX_BYTES = 5 * 1024 * 1024;
const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
const KEYWORDS_SHOWN = 3;

interface Attachment { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string }
interface Review {
  id: string; reviewType: ReviewType; clientName: string; content: string; keywords: string[]; isPublished: boolean;
  attachmentCount: number; createdBy: { id: string; name: string }; createdAt: string; updatedAt: string;
}
interface ReviewDetail extends Review { attachments: Attachment[] }

const filePath = (reviewId: string, attachmentId: string) => `/client-reviews/${reviewId}/attachments/${attachmentId}`;
const isImage = (mimeType: string) => mimeType.startsWith('image/');
const collapse = (text: string) => text.trim().replace(/\s+/g, ' ');

function useSize() {
  const { t } = useI18n();
  return (bytes: number) =>
    bytes >= 1024 * 1024
      ? t.reviews.sizeMb(fmtNumber((bytes / (1024 * 1024)).toFixed(1)))
      : t.reviews.sizeKb(fmtNumber(Math.max(1, Math.round(bytes / 1024))));
}

/** A stored attachment as an object URL (the file needs the session cookie, so no plain <img src>). */
function useAttachmentUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    let made: string | null = null;
    get<Blob>(path, { blob: true }).then((blob) => {
      if (!live) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    }, () => {});
    return () => { live = false; if (made) URL.revokeObjectURL(made); setUrl(null); };
  }, [path]);
  return url;
}

// ---------- shared pieces ----------

function Keywords({ list, max }: { list: string[]; max?: number }) {
  const { t } = useI18n();
  const shown = max ? list.slice(0, max) : list;
  return (
    <span className="review-keywords">
      {shown.map((k) => <Badge key={k} tone="outline">{k}</Badge>)}
      {list.length > shown.length && <Badge tone="neutral" title={list.slice(shown.length).join(t.common.listSep)}>{t.reviews.moreKeywords(fmtNumber(list.length - shown.length))}</Badge>}
    </span>
  );
}

function PublishedBadge({ published }: { published: boolean }) {
  const { t } = useI18n();
  return <Badge tone={published ? 'success' : 'neutral'} dot>{published ? t.reviews.published : t.reviews.draft}</Badge>;
}

/** One file: a picture preview or a document icon, its name and size; opens on click. */
function FileTile({ name, mimeType, sizeBytes, previewUrl, isNew, onOpen, onRemove }: {
  name: string; mimeType: string; sizeBytes: number; previewUrl: string | null; isNew?: boolean;
  onOpen: () => void; onRemove?: () => void;
}) {
  const { t } = useI18n();
  const size = useSize();
  return (
    <li className="file-tile">
      <button type="button" className="file-tile__open" onClick={onOpen} title={t.reviews.openFile(name)}>
        <span className="file-tile__media">
          {previewUrl ? <img src={previewUrl} alt="" /> : <Icon name={isImage(mimeType) ? 'image' : 'file-text'} />}
        </span>
        <span className="file-tile__name"><bdi>{name}</bdi></span>
        <span className="file-tile__meta">
          {isNew && <Badge tone="info">{t.reviews.newFile}</Badge>}
          <bdi>{size(sizeBytes)}</bdi>
        </span>
      </button>
      {onRemove && (
        <button type="button" className="file-tile__remove" aria-label={t.reviews.remove(name)} title={t.reviews.remove(name)} onClick={onRemove}>
          <Icon name="x" />
        </button>
      )}
    </li>
  );
}

/** An attachment already saved on the review (its preview is fetched with the session). */
function StoredTile({ reviewId, file, onRemove }: { reviewId: string; file: Attachment; onRemove?: () => void }) {
  const path = filePath(reviewId, file.id);
  const preview = useAttachmentUrl(isImage(file.mimeType) ? path : null);
  return (
    <FileTile
      name={file.fileName} mimeType={file.mimeType} sizeBytes={file.sizeBytes} previewUrl={preview}
      onOpen={() => openFile(path)} onRemove={onRemove}
    />
  );
}

// ---------- list ----------

/** OWNER: every client review, newest first, paged on the server; search, type and published filters in the URL. */
export function ClientReviews() {
  const { t } = useI18n();
  const tr = t.reviews;
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const status = params.get('status') ?? '';
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const [viewing, setViewing] = useState<string | null>(null);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const path = `/client-reviews${qs({
    search: q, reviewType: type, isPublished: status === 'published' ? true : status === 'draft' ? false : undefined,
  })}`;
  const { res, reload, pager } = usePaged<Page<Review>>(path, 20);
  const rows = res?.items ?? [];
  const filtered = !!(q || type || status);

  const remove = async (r: Review) => {
    const ok = await confirmAction({
      title: tr.deleteTitle, message: msg().reviews.confirmDelete(r.clientName), tone: 'danger', confirmLabel: t.common.delete,
    });
    if (!ok) return;
    if (await act(() => del(`/client-reviews/${r.id}`), tr.deleted)) {
      if (viewing === r.id) setViewing(null);
      reload();
    }
  };
  const togglePublish = (r: Review) =>
    act(() => patch(`/client-reviews/${r.id}`, { isPublished: !r.isPublished }), r.isPublished ? tr.unpublishedDone : tr.publishedDone)
      .then((ok) => { if (ok) reload(); });

  const c = tr.col;
  return (
    <>
      <PageHeader
        title={tr.title} description={tr.subtitle}
        actions={<ButtonLink to="/owner/reviews/new" variant="primary" icon="plus">{tr.add}</ButtonLink>}
      />

      <div className="stack-lg">
        <Card>
          <div className="review-filters">
            <form className="input-group" role="search" onSubmit={(e) => { e.preventDefault(); setParam('q', search.trim()); }}>
              <SearchInput placeholder={tr.searchPh} aria-label={tr.searchPh} maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button type="submit" variant="primary" icon="search">{t.common.search}</Button>
            </form>
            <Select aria-label={tr.typeFilter} value={type} onChange={(e) => setParam('type', e.target.value)}>
              <option value="">{tr.allTypes}</option>
              {TYPES.map((v) => <option key={v} value={v}>{label(t.enums.ClientReviewType, v)}</option>)}
            </Select>
            <Select aria-label={tr.statusFilter} value={status} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">{tr.allStatuses}</option>
              <option value="published">{tr.published}</option>
              <option value="draft">{tr.draft}</option>
            </Select>
            {filtered && <Button variant="ghost" icon="x" onClick={() => setParams({}, { replace: true })}>{t.ui.clearFilters}</Button>}
          </div>
        </Card>

        <Card flush title={tr.title} icon="message" description={res && tr.count(fmtNumber(res.meta.total))}>
          {!res ? <Loading /> : (
            <Table
              dense
              head={<>
                <th>{c.client}</th><th>{c.type}</th><th>{c.review}</th><th>{c.keywords}</th><th>{c.files}</th><th>{c.status}</th>
                <th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
              </>}
              isEmpty={rows.length === 0}
              empty={filtered
                ? <EmptyState compact icon="search" title={t.ui.noResults} text={t.ui.noResultsHint} />
                : <EmptyState compact icon="message" title={tr.empty} text={tr.emptyHint}
                    action={<ButtonLink to="/owner/reviews/new" variant="primary" icon="plus">{tr.add}</ButtonLink>} />}
            >
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="review-client"><Person name={r.clientName} size={32} meta={tr.addedOn(fmtDate(r.createdAt.slice(0, 10)))} /></td>
                  <td><StatusBadge kind="ClientReviewType" value={r.reviewType} dot={false} /></td>
                  <td><p className="review-excerpt" dir="auto" title={r.content}>{r.content}</p></td>
                  <td>{r.keywords.length ? <Keywords list={r.keywords} max={KEYWORDS_SHOWN} /> : <span className="text-muted">{t.common.none}</span>}</td>
                  <td className="nowrap">
                    {r.attachmentCount > 0
                      ? <span className="review-files" title={tr.filesCount(fmtNumber(r.attachmentCount))}><Icon name="paperclip" />{fmtNumber(r.attachmentCount)}</span>
                      : <span className="text-muted">{t.common.none}</span>}
                  </td>
                  <td><PublishedBadge published={r.isPublished} /></td>
                  <td className="actions">
                    <div className="row-actions review-row-actions">
                      <IconButton icon="eye" label={t.ui.view} onClick={() => setViewing(r.id)} />
                      <Link className="icon-btn" to={`/owner/reviews/${r.id}/edit`} aria-label={t.common.edit} title={t.common.edit}><Icon name="pencil" /></Link>
                      <IconButton icon={r.isPublished ? 'eye-off' : 'globe'} label={r.isPublished ? tr.unpublish : tr.publish} onClick={() => togglePublish(r)} />
                      <IconButton icon="trash" variant="danger" label={t.common.delete} onClick={() => remove(r)} />
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {pager}
        </Card>
      </div>

      {viewing && <ReviewDialog id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** The whole review: text, keywords and attachments (pictures previewed, every file opens in a new tab). */
function ReviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const tr = t.reviews;
  const [r, , loading] = useLoad(() => get<ReviewDetail>(`/client-reviews/${id}`), [id]);
  return (
    <Dialog
      open onClose={onClose} size="lg" title={r ? tr.viewTitle(r.clientName) : tr.title}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t.common.close}</Button>
        {r && <ButtonLink to={`/owner/reviews/${id}/edit`} variant="primary" icon="pencil">{t.common.edit}</ButtonLink>}
      </>}
    >
      {!r ? (loading ? <Loading /> : <EmptyState compact icon="alert-circle" title={t.errors.http[404]} />) : (
        <div className="stack">
          <div className="cluster">
            <StatusBadge kind="ClientReviewType" value={r.reviewType} dot={false} />
            <PublishedBadge published={r.isPublished} />
          </div>
          <p className="review-text" dir="auto">{r.content}</p>
          <section>
            <h3 className="review-section-title">{tr.keywordsLabel}</h3>
            {r.keywords.length ? <Keywords list={r.keywords} /> : <p className="text-muted text-body-sm">{tr.noKeywords}</p>}
          </section>
          <section>
            <h3 className="review-section-title">{tr.attachmentsLabel}</h3>
            {r.attachments.length ? (
              <ul className="file-tiles">{r.attachments.map((a) => <StoredTile key={a.id} reviewId={r.id} file={a} />)}</ul>
            ) : <p className="text-muted text-body-sm">{tr.noFiles}</p>}
          </section>
          <p className="text-muted text-body-sm">{tr.addedBy(fmtDateTime(r.createdAt), r.createdBy.name)}</p>
        </div>
      )}
    </Dialog>
  );
}

// ---------- add / edit ----------

interface NewFile { key: string; file: File; previewUrl: string | null }
interface Errors { clientName?: string; content?: string }

let fileSeq = 0;

/** OWNER: add a review (/owner/reviews/new) or edit one (/owner/reviews/:id/edit). One request saves everything. */
export function ClientReviewForm() {
  const { t } = useI18n();
  const tr = t.reviews;
  const { id } = useParams();
  const editing = id !== undefined;
  const nav = useNavigate();
  const [review, , loadingReview] = useLoad(
    () => (id ? get<ReviewDetail>(`/client-reviews/${id}`) : Promise.resolve(undefined)), [id],
  );

  const [reviewType, setReviewType] = useState<ReviewType>('TEXT');
  const [clientName, setClientName] = useState('');
  const [content, setContent] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [newFiles, setNewFiles] = useState<NewFile[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // The review being edited fills the form once it arrives.
  useEffect(() => {
    if (!review) return;
    setReviewType(review.reviewType); setClientName(review.clientName); setContent(review.content);
    setKeywords(review.keywords); setIsPublished(review.isPublished); setRemoved([]); setDirty(false);
  }, [review]);

  // Picked pictures are previewed from object URLs; free them when the page closes.
  const urls = useRef(new Set<string>());
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const changed = <T,>(set: (value: T) => void) => (value: T) => { set(value); setDirty(true); };

  const stored = (review?.attachments ?? []).filter((a) => !removed.includes(a.id));
  const fileCount = stored.length + newFiles.length;
  const full = fileCount >= FILES_MAX;

  const addKeywords = (text: string) => {
    const next = [...keywords];
    for (const raw of text.split(/[,،]/)) {
      const k = collapse(raw).slice(0, KEYWORD_MAX);
      if (k && next.length < KEYWORDS_MAX && !next.some((x) => x.toLocaleLowerCase() === k.toLocaleLowerCase())) next.push(k);
    }
    return next;
  };
  const commitKeyword = () => {
    if (!keyword.trim()) return;
    setKeywords(addKeywords(keyword));
    setKeyword('');
    setDirty(true);
  };
  const onKeywordKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === '،') && !e.nativeEvent.isComposing) {
      e.preventDefault();
      commitKeyword();
    } else if (e.key === 'Backspace' && !keyword && keywords.length) {
      setKeywords(keywords.slice(0, -1));
      setDirty(true);
    }
  };

  const takeFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const problems: string[] = [];
    const accepted: NewFile[] = [];
    let room = FILES_MAX - fileCount;
    for (const file of Array.from(list)) {
      const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
      if (!MIME_TYPES.includes(file.type) && !EXTENSIONS.includes(extension)) problems.push(tr.errors.fileType(file.name));
      else if (file.size > FILE_MAX_BYTES) problems.push(tr.errors.fileSize(file.name));
      else if (room <= 0) { if (!problems.includes(tr.errors.tooMany(fmtNumber(FILES_MAX)))) problems.push(tr.errors.tooMany(fmtNumber(FILES_MAX))); }
      else {
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
        if (previewUrl) urls.current.add(previewUrl);
        accepted.push({ key: `f${++fileSeq}`, file, previewUrl });
        room--;
      }
    }
    setFileErrors(problems);
    if (accepted.length) { setNewFiles((old) => [...old, ...accepted]); setDirty(true); }
  };
  const dropNewFile = (f: NewFile) => {
    if (f.previewUrl) { URL.revokeObjectURL(f.previewUrl); urls.current.delete(f.previewUrl); }
    setNewFiles((old) => old.filter((x) => x.key !== f.key));
    setFileErrors([]);
    setDirty(true);
  };
  const openNewFile = (f: NewFile) => {
    const url = f.previewUrl ?? URL.createObjectURL(f.file);
    if (!f.previewUrl) { urls.current.add(url); }
    window.open(url, '_blank', 'noopener');
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!full) takeFiles(e.dataTransfer.files);
  };

  const validate = (): Errors => {
    const name = collapse(clientName);
    return {
      clientName: name.length < NAME_MIN || name.length > NAME_MAX ? tr.errors.clientName : undefined,
      content: !content.trim() ? tr.errors.content : undefined,
    };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (found.clientName) { nameRef.current?.focus(); return; }
    if (found.content) { contentRef.current?.focus(); return; }
    // A keyword still in the box counts too.
    const finalKeywords = keyword.trim() ? addKeywords(keyword) : keywords;

    const form = new FormData();
    form.append('reviewType', reviewType);
    form.append('clientName', collapse(clientName));
    form.append('content', content.trim());
    // One empty field means "no keywords" (multipart cannot send an empty list).
    if (finalKeywords.length) finalKeywords.forEach((k) => form.append('keywords', k)); else form.append('keywords', '');
    form.append('isPublished', String(isPublished));
    newFiles.forEach((f) => form.append('attachments', f.file, f.file.name));
    removed.forEach((attachmentId) => form.append('removeAttachmentIds', attachmentId));

    setSaving(true);
    const ok = await act(() => (editing ? patch(`/client-reviews/${id}`, form) : post('/client-reviews', form)), editing ? tr.saved : tr.added);
    setSaving(false);
    if (ok) nav('/owner/reviews');
  };

  const cancel = async () => {
    if (dirty && !(await confirmAction({ title: tr.leaveTitle, message: tr.leaveText, confirmLabel: tr.leave, tone: 'danger' }))) return;
    nav('/owner/reviews');
  };

  const header = (
    <PageHeader
      title={editing ? tr.editTitle : tr.newTitle} description={editing ? tr.editSubtitle : tr.newSubtitle}
      back={{ to: '/owner/reviews', label: tr.title }}
    />
  );
  if (editing && !review) {
    return (
      <div className="review-editor">
        {header}
        {loadingReview ? <Loading /> : (
          <EmptyState
            icon="alert-circle" title={t.errors.http[404]}
            action={<ButtonLink to="/owner/reviews" variant="secondary" icon="arrow-left">{tr.title}</ButtonLink>}
          />
        )}
      </div>
    );
  }

  return (
    <div className="review-editor">
      {header}
      <form className="card review-form" onSubmit={submit} noValidate>
        <Field group label={tr.typeLabel}>
          <Segmented
            block label={tr.typeLabel} value={reviewType} onChange={changed(setReviewType)}
            options={TYPES.map((v) => ({ value: v, label: label(t.enums.ClientReviewType, v), icon: TYPE_ICONS[v] }))}
          />
        </Field>

        <Field label={tr.clientLabel} error={errors.clientName}>
          <Input
            ref={nameRef} value={clientName} maxLength={NAME_MAX} placeholder={tr.clientPh} autoComplete="off" dir="auto"
            aria-invalid={!!errors.clientName || undefined}
            onChange={(e) => { changed(setClientName)(e.target.value); if (errors.clientName) setErrors({ ...errors, clientName: undefined }); }}
          />
        </Field>

        <Field label={tr.contentLabel} error={errors.content} hint={tr.charCount(fmtNumber(content.length), fmtNumber(CONTENT_MAX))}>
          <Textarea
            ref={contentRef} rows={7} value={content} maxLength={CONTENT_MAX} placeholder={tr.contentPh} dir="auto"
            aria-invalid={!!errors.content || undefined}
            onChange={(e) => { changed(setContent)(e.target.value); if (errors.content) setErrors({ ...errors, content: undefined }); }}
          />
        </Field>

        <div className="stack-sm">
          <Field label={tr.keywordsLabel} optional hint={tr.keywordsHint(fmtNumber(keywords.length), fmtNumber(KEYWORDS_MAX))}>
            <Input
              value={keyword} maxLength={KEYWORD_MAX} placeholder={tr.keywordPh} disabled={keywords.length >= KEYWORDS_MAX}
              onChange={(e) => setKeyword(e.target.value)} onKeyDown={onKeywordKey} onBlur={commitKeyword}
            />
          </Field>
          {keywords.length > 0 && (
            <div className="keyword-chips">
              {keywords.map((k) => (
                <span key={k} className="chip">
                  <bdi>{k}</bdi>
                  <button type="button" aria-label={tr.removeKeyword(k)} title={tr.removeKeyword(k)}
                    onClick={() => { setKeywords(keywords.filter((x) => x !== k)); setDirty(true); }}>
                    <Icon name="x" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <Field group label={tr.attachmentsLabel} optional hint={tr.attachmentsHint(fmtNumber(FILES_MAX))}>
          <label
            className={cx('review-drop', dragOver && 'is-over', full && 'is-disabled')}
            onDragOver={(e) => { e.preventDefault(); if (!full) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <input
              type="file" multiple accept={MIME_TYPES.join(',')} disabled={full} aria-label={tr.dropTitle}
              onChange={(e) => { takeFiles(e.target.files); e.target.value = ''; }}
            />
            <span className="icon-circle review-drop__plus"><Icon name="plus" /></span>
            <span className="review-drop__title">{full ? tr.errors.tooMany(fmtNumber(FILES_MAX)) : tr.dropTitle}</span>
            {!full && <span className="review-drop__text">{tr.dropText}</span>}
          </label>
          {fileErrors.length > 0 && (
            <Alert tone="error" className="review-file-errors">
              {fileErrors.map((problem) => <div key={problem}><bdi>{problem}</bdi></div>)}
            </Alert>
          )}
          {fileCount > 0 && (
            <ul className="file-tiles">
              {review && stored.map((a) => (
                <StoredTile key={a.id} reviewId={review.id} file={a} onRemove={() => { setRemoved([...removed, a.id]); setFileErrors([]); setDirty(true); }} />
              ))}
              {newFiles.map((f) => (
                <FileTile
                  key={f.key} name={f.file.name} mimeType={f.file.type} sizeBytes={f.file.size} previewUrl={f.previewUrl} isNew
                  onOpen={() => openNewFile(f)} onRemove={() => dropNewFile(f)}
                />
              ))}
            </ul>
          )}
        </Field>

        <div className="review-publish">
          <Switch label={tr.publishLabel} checked={isPublished} onChange={changed(setIsPublished)} />
          <p className="field__help">{tr.publishHint}</p>
        </div>

        <div className="review-form__actions">
          <Button type="submit" variant="primary" size="lg" block icon={editing ? 'check' : 'plus'} loading={saving}>
            {editing ? tr.save : tr.create}
          </Button>
          <Button variant="ghost" block onClick={cancel} disabled={saving}>{t.common.cancel}</Button>
        </div>
      </form>
    </div>
  );
}
