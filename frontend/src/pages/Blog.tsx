// Blog: the owner's editor (staff app) and the public list and post pages.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type Quill from 'quill';
import { act, API, del, get, patch, post, qs } from '../api';
import { usePaged } from '../components';
import { fmtNumber } from '../format';
import { label, msg, useI18n } from '../i18n';
import { usePageTitle } from '../layout/PublicLayout';
import { TZ } from '../time';
import {
  Badge, Button, ButtonLink, Card, confirmAction, EmptyState, Field, Icon, IconButton, Input, LoadMore, Loading,
  PageBanner, PageHeader, Select, Table, Textarea,
} from '../ui';
import { Ltr, useLoad } from '../util';
import '../styles/areas/site.css';

// The backend's order (blog.enums.ts); labels in t.enums.BlogCategory.
const CATEGORIES = [
  'NEUROLOGICAL', 'ORTHOPEDIC_SPINE', 'SPORTS_INJURIES', 'NUTRITION_BODY_SHAPING', 'CHEST', 'OBSTETRICS_GYNECOLOGY',
  'CARDIAC', 'INTERNAL_GERIATRIC', 'OTHER',
];
const MIN_KEYWORDS = 5;
const MAX_KEYWORDS = 20;
const PAGE_SIZE = 6;

// Toolbar: heading (Normal), bold / italic / underline, lists, align, link, clear formatting.
const TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ align: [] }],
  ['link'],
  ['clean'],
];

interface PostRef { id: string; updatedAt: string }
export interface PublicPost extends PostRef { title: string; description: string; category: string; createdAt: string }

/** Covers are public files; `v` changes when the post is edited, so a replaced cover is not served from cache. */
export const coverUrl = (p: PostRef) => `${API}/public/blog-posts/${p.id}/cover?v=${encodeURIComponent(p.updatedAt)}`;

/** dd/MM/yyyy in clinic time, as on the website (also in Arabic). */
const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));

function PostDate({ iso }: { iso: string }) {
  return <span className="media-card__date"><Icon name="calendar" /><Ltr>{fmtDay(iso)}</Ltr></span>;
}

/** A blog post card (public list and the home page): the whole card opens the post. */
export function PostCard({ post: p }: { post: PublicPost }) {
  const { t } = useI18n();
  return (
    <article className="card card--marketing card--interactive media-card">
      <div className="media-card__media">
        <img src={coverUrl(p)} alt="" loading="lazy" width={800} height={500} />
      </div>
      <div className="media-card__body">
        <div className="media-card__meta">
          <PostDate iso={p.createdAt} />
          <Badge tone="neutral">{label(t.enums.BlogCategory, p.category)}</Badge>
        </div>
        <h3 className="media-card__title"><Link to={`/blog/${p.id}`}>{p.title}</Link></h3>
        <p className="media-card__excerpt">{p.description}</p>
        <span className="media-card__more" aria-hidden="true">{t.blog.readMore}<Icon name="arrow-right" /></span>
      </div>
    </article>
  );
}

// ---------- owner: write / edit ----------

// Quill (about 200 kB) is loaded only when the owner opens the blog page, so the public site does not download it.
let QuillClass: typeof Quill | null = null;
const loadQuill = () => Promise.all([import('quill'), import('quill/dist/quill.snow.css')]).then(([m]) => { QuillClass = m.default; });

/** True once the editor library is loaded (it starts loading on first use). */
function useQuillReady() {
  const [ready, setReady] = useState(QuillClass !== null);
  useEffect(() => {
    if (ready) return;
    let live = true;
    loadQuill().then(() => { if (live) setReady(true); }, () => {});
    return () => { live = false; };
  }, [ready]);
  return ready;
}

/** Quill "snow" editor (render it only once useQuillReady() is true). The parent reads and sets the content through `editor`. */
function Editor({ editor, placeholder }: { editor: React.MutableRefObject<Quill | null>; placeholder: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current!;
    const quill = new QuillClass!(el.appendChild(document.createElement('div')), {
      theme: 'snow', placeholder, modules: { toolbar: TOOLBAR },
    });
    editor.current = quill;
    return () => { editor.current = null; el.innerHTML = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Language switch: new placeholder.
  useEffect(() => { editor.current?.root.setAttribute('data-placeholder', placeholder); }, [editor, placeholder]);
  return <div className="blog-editor" ref={host} />;
}

/** The editor's HTML for the API: semantic lists (<ul>/<ol>). Quill 2 writes every space as &nbsp; there; undo that. */
const editorHtml = (quill: Quill) => (quill.getText().trim() ? quill.getSemanticHTML().replaceAll('&nbsp;', ' ') : '');

/** Owner: write, edit and delete blog posts. A post is on the website as soon as it is added. */
export function BlogAdmin() {
  const { t } = useI18n();
  const tb = t.blog;
  // Deleting the last post of the last page falls back a page by itself (usePaged).
  const { res, reload, pager } = usePaged('/blog-posts', 20);
  const editor = useRef<Quill | null>(null);
  const quillReady = useQuillReady();
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('');
  const [image, setImage] = useState<File | null>(null);
  // A picked file (blob: URL) or the current cover of the post being edited.
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);

  const reset = () => {
    setEditing(null); setTitle(''); setDescription(''); setKeywords([]); setKeyword(''); setCategory('');
    setImage(null); setPreview(null);
    editor.current?.setText('', 'silent');
  };

  const addKeyword = () => {
    const k = keyword.trim();
    setKeyword('');
    if (!k || keywords.length >= MAX_KEYWORDS || keywords.some((x) => x.toLocaleLowerCase() === k.toLocaleLowerCase())) return;
    setKeywords([...keywords, k]);
  };

  const takeFile = (file: File | undefined | null) => {
    if (!file) return;
    setImage(file);
    setPreview(URL.createObjectURL(file));
  };
  const pickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same file again still fires onChange
    takeFile(file);
  };

  const edit = (row: { id: string }) => act(async () => {
    const p = await get(`/blog-posts/${row.id}`);
    setEditing({ id: p.id, title: p.title });
    setTitle(p.title); setDescription(p.description); setKeywords(p.keywords); setKeyword(''); setCategory(p.category);
    setImage(null); setPreview(coverUrl(p));
    editor.current?.clipboard.dangerouslyPasteHTML(p.content, 'silent'); // server-sanitized
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const submit = () => act(async () => {
    const form = new FormData();
    form.append('title', title);
    form.append('description', description);
    keywords.forEach((k) => form.append('keywords', k));
    form.append('category', category);
    form.append('content', editor.current ? editorHtml(editor.current) : '');
    if (image) form.append('image', image);
    if (editing) await patch(`/blog-posts/${editing.id}`, form);
    else await post('/blog-posts', form);
  }, editing ? tb.saved : tb.added).then((ok) => {
    if (!ok) return;
    reset();
    reload();
  });

  const remove = async (p: { id: string; title: string }) => {
    if (!(await confirmAction({ title: tb.deleteTitle, message: msg().blog.confirmDelete(p.title), tone: 'danger', confirmLabel: t.common.delete }))) return;
    const ok = await act(() => del(`/blog-posts/${p.id}`), tb.deleted);
    if (ok && editing?.id === p.id) reset();
    reload();
  };

  const rows: any[] = res?.items ?? [];
  const enough = keywords.length >= MIN_KEYWORDS;
  if (!quillReady) return <Loading />;
  return (
    <>
      <PageHeader
        title={editing ? tb.editing(editing.title) : tb.adminTitle}
        tabTitle={tb.adminTitle}
        description={tb.adminSubtitle}
        actions={<ButtonLink to="/blog" icon="external-link" target="_blank">{t.shell.publicSite}</ButtonLink>}
      />

      <div className="blog-compose">
        <Card title={tb.write} icon="note-pen">
          <Editor editor={editor} placeholder={tb.editorPh} />
        </Card>

        <Card title={tb.info} icon="file-text">
          <div className="stack">
            <Field label={tb.titleLabel}>
              <Input placeholder={tb.titlePh} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={tb.descriptionLabel}>
              <Textarea rows={3} placeholder={tb.descriptionPh} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field
              label={tb.keywordsLabel}
              hint={<span className={`keyword-count${enough ? ' is-ok' : ''}`}>{tb.keywordCount(fmtNumber(keywords.length), fmtNumber(MIN_KEYWORDS))}</span>}
            >
              <Input
                placeholder={tb.keywordPh} maxLength={50} value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addKeyword(); } }}
              />
            </Field>
            {keywords.length > 0 && (
              <div className="keyword-chips">
                {keywords.map((k) => (
                  <span key={k} className="chip">
                    {k}
                    <button type="button" aria-label={tb.removeKeyword(k)} title={tb.removeKeyword(k)} onClick={() => setKeywords(keywords.filter((x) => x !== k))}>
                      <Icon name="x" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Field label={tb.categoryLabel}>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{tb.categoryPh}</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{label(t.enums.BlogCategory, c)}</option>)}
              </Select>
            </Field>

            <div className="field">
              <span className="field__label">{tb.image}</span>
              <label
                className={`cover-drop${preview ? ' has-image' : ''}${dragOver ? ' is-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); takeFile(e.dataTransfer.files?.[0]); }}
              >
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pickImage} aria-label={tb.pickImage} />
                {preview ? (
                  <>
                    <img src={preview} alt="" />
                    <span className="cover-drop__replace"><Icon name="image" />{tb.replaceImage}</span>
                  </>
                ) : (
                  <span className="cover-drop__text">
                    <span className="icon-circle"><Icon name="upload" /></span>
                    <span className="cover-drop__title">{tb.pickImage}</span>
                    <span className="cover-drop__hint">{tb.imageHint}</span>
                  </span>
                )}
              </label>
            </div>

            <div className="form-actions">
              <Button variant="primary" icon={editing ? 'check' : 'upload'} onClick={submit}>{editing ? tb.save : tb.add}</Button>
              {editing && <Button variant="ghost" onClick={reset}>{t.common.cancelEdit}</Button>}
            </div>
          </div>
        </Card>
      </div>

      <Card flush title={tb.posts} icon="list">
        {!res ? <Loading /> : (
          <Table
            head={<>
              <th>{tb.col.cover}</th><th>{tb.col.title}</th><th>{tb.col.category}</th><th>{tb.col.date}</th><th>{tb.col.author}</th>
              <th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
            </>}
            isEmpty={rows.length === 0}
            empty={<EmptyState compact icon="file-text" title={tb.noPosts} text={tb.noPostsHint} />}
          >
            {rows.map((p) => (
              <tr key={p.id} className={editing?.id === p.id ? 'is-selected' : undefined}>
                <td><img className="blog-thumb" src={coverUrl(p)} alt="" width={72} height={45} loading="lazy" /></td>
                <td className="cell-strong">{p.title}</td>
                <td><Badge tone="neutral">{label(t.enums.BlogCategory, p.category)}</Badge></td>
                <td className="nowrap"><Ltr>{fmtDay(p.createdAt)}</Ltr></td>
                <td>{p.author.name}</td>
                <td className="actions">
                  <div className="row-actions">
                    <IconButton icon="pencil" label={t.common.edit} onClick={() => edit(p)} />
                    <Link className="icon-btn" to={`/blog/${p.id}`} aria-label={tb.view} title={tb.view}><Icon name="eye" /></Link>
                    <IconButton icon="trash" variant="danger" label={t.common.delete} onClick={() => remove(p)} />
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {pager}
      </Card>
    </>
  );
}

// ---------- public website ----------

/** The blog list, no login. Newest first, 3 cards per row, "show more" pages. */
export function PublicBlog() {
  const { t } = useI18n();
  const tb = t.blog;
  usePageTitle(tb.ourBlogs);
  const [category, setCategory] = useState('');
  const [items, setItems] = useState<PublicPost[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);

  const load = async (cat: string, p: number) => {
    const request = ++latest.current;
    setLoading(true);
    try {
      const r = await get(`/public/blog-posts${qs({ category: cat, page: p, limit: PAGE_SIZE })}`, { noAuth: true });
      if (request !== latest.current) return; // the filter changed meanwhile
      setItems((old) => (p === 1 ? r.items : [...old, ...r.items]));
      setPage(p);
      setPages(r.meta.totalPages);
    } catch { /* shown in the error toast */ } finally {
      if (request === latest.current) { setLoading(false); setLoaded(true); }
    }
  };
  useEffect(() => { load(category, 1); }, [category]);

  return (
    <>
      <PageBanner
        image="/assets/images/covers/blog.jpg" title={tb.ourBlogs} text={tb.ourBlogsText}
        crumbs={[{ to: '/', label: t.site.home }, { label: tb.ourBlogs }]}
      />
      <div className="container blog-page">
        <div className="blog-toolbar">
          <Field label={tb.filter}>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{tb.all}</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{label(t.enums.BlogCategory, c)}</option>)}
            </Select>
          </Field>
        </div>
        {!loaded && loading ? <Loading /> : items.length === 0 ? (
          <EmptyState icon="file-text" title={tb.empty} />
        ) : (
          <div className="media-grid">
            {items.map((p) => <PostCard key={p.id} post={p} />)}
          </div>
        )}
        {page < pages && <LoadMore loading={loading} onClick={() => load(category, page + 1)}>{tb.showMore}</LoadMore>}
      </div>
    </>
  );
}

/** One blog post. The content is HTML the server already sanitized (allowlist). */
export function PublicBlogPost() {
  const { t } = useI18n();
  const tb = t.blog;
  const { id } = useParams();
  const [p, , loading] = useLoad(() => get(`/public/blog-posts/${id}`, { noAuth: true }), [id]);
  usePageTitle(p?.title ?? tb.ourBlogs);
  return (
    <article className="article">
      <Link className="article__back" to="/blog"><Icon name="arrow-left" />{tb.back}</Link>
      {!p && loading && <Loading />}
      {!p && !loading && (
        <EmptyState
          icon="file-text" title={tb.notFound}
          action={<ButtonLink to="/blog" variant="secondary">{tb.back}</ButtonLink>}
        />
      )}
      {p && <>
        <h1 className="article__title">{p.title}</h1>
        <div className="article__meta">
          <PostDate iso={p.createdAt} />
          <Badge tone="success">{label(t.enums.BlogCategory, p.category)}</Badge>
        </div>
        <img className="article__cover" src={coverUrl(p)} alt="" width={1280} height={720} />
        <div className="blog-content" dangerouslySetInnerHTML={{ __html: p.content }} />
        {p.keywords.length > 0 && (
          <div className="article__keywords">
            <h2>{tb.keywords}</h2>
            {p.keywords.map((k: string) => <Badge key={k} tone="neutral">{k}</Badge>)}
          </div>
        )}
      </>}
    </article>
  );
}
