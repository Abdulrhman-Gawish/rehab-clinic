// The public home page (FRONTEND_IMPLEMENTATION_GUIDE.md section 9.2): hero with the founder, the statistics strip
// overlapping it, services, specialisations, the founder feature, the latest blog posts and a closing call to action.
import { get, qs } from '../api';
import { fmtNumber } from '../format';
import { useI18n } from '../i18n';
import type { Messages } from '../i18n/en';
import { usePageTitle } from '../layout/PublicLayout';
import { SITE } from '../site';
import { ButtonLink, Icon, IconCircle, SectionHeading, type IconName } from '../ui';
import { Ltr, useLoad } from '../util';
import { PostCard, type PublicPost } from './Blog';
import '../styles/areas/site.css';

type StatKey = keyof Messages['home']['stats'];
const STATS: { key: StatKey; icon: IconName; plus?: boolean }[] = [
  { key: 'beds', icon: 'bed' },
  { key: 'sessions', icon: 'briefcase-medical', plus: true },
  { key: 'clients', icon: 'users', plus: true },
  { key: 'doctors', icon: 'stethoscope' },
  { key: 'years', icon: 'award' },
];

type ServiceKey = keyof Messages['home']['services'];
const SERVICES: { key: ServiceKey; icon: IconName }[] = [
  { key: 'doctors', icon: 'stethoscope' },
  { key: 'diagnosis', icon: 'clipboard-check' },
  { key: 'care', icon: 'heart-pulse' },
  { key: 'equipment', icon: 'activity' },
  { key: 'rehab', icon: 'accessibility' },
  { key: 'recovery', icon: 'briefcase-medical' },
  { key: 'online', icon: 'laptop' },
  { key: 'nutrition', icon: 'apple' },
];

type SpecKey = keyof Messages['home']['specialisations'];
const SPECIALISATIONS: { key: SpecKey; image: string; width: number; height: number }[] = [
  { key: 'ortho', image: '/assets/images/specializations/orthopedics-spine.jpg', width: 1024, height: 683 },
  { key: 'neuro', image: '/assets/images/specializations/neuro-paralysis.jpg', width: 1024, height: 683 },
  { key: 'obesity', image: '/assets/images/specializations/obesity-body-shaping.webp', width: 1200, height: 700 },
];

export function Home() {
  const { t } = useI18n();
  const th = t.home;
  usePageTitle(null);
  const [posts] = useLoad(
    () => get<{ items: PublicPost[] }>(`/public/blog-posts${qs({ page: 1, limit: 3 })}`, { noAuth: true }).then((r) => r.items),
    [],
  );

  return (
    <>
      {/* Hero */}
      <section className="hero" aria-labelledby="hero-title">
        <img className="hero__bg" src="/assets/images/hero/hero-clinic-1.jpg" alt="" width={1920} height={1280} fetchPriority="high" />
        <div className="container-wide hero__inner">
          <div className="hero__text">
            <span className="hero__kicker"><Icon name="map-pin" />{th.heroKicker}</span>
            <h1 className="hero__title" id="hero-title">{th.heroTitle}</h1>
            <p className="hero__lead">{th.heroText}</p>
            <div className="hero__actions">
              <ButtonLink to="/book" variant="inverse" size="lg" icon="calendar">{t.site.bookNow}</ButtonLink>
              <a className="btn btn--inverse-outline btn--lg" href={SITE.whatsapp} target="_blank" rel="noopener noreferrer">
                <Icon name="message" />{t.site.whatsapp}
              </a>
            </div>
          </div>
          <figure className="hero__portrait">
            <img src="/assets/images/team/founder-white-coat.jpg" alt={th.founderAlt} width={798} height={1492} />
          </figure>
        </div>
      </section>

      {/* Statistics strip overlapping the hero */}
      <section className="container stats-strip" aria-label={th.statsLabel}>
        <div className="stats-strip__card">
          {STATS.map((s) => (
            <div key={s.key} className="stats-strip__item">
              <IconCircle icon={s.icon} size={56} />
              <span className="stats-strip__value"><Ltr>{s.plus ? '+' : ''}{fmtNumber(SITE.stats[s.key])}</Ltr></span>
              <span className="stats-strip__label">{th.stats[s.key]}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Services */}
      <section className="section">
        <div className="container">
          <SectionHeading kicker={th.servicesKicker} title={th.servicesTitle} description={th.servicesText} />
          <div className="service-grid">
            {SERVICES.map((s) => (
              <article key={s.key} className="card card--marketing card--interactive service-card">
                <IconCircle icon={s.icon} size={64} />
                <h3>{th.services[s.key].title}</h3>
                <p>{th.services[s.key].text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Specialisations */}
      <section className="section section--subtle">
        <div className="container">
          <SectionHeading kicker={th.specialisationsKicker} title={th.specialisationsTitle} />
          <div className="spec-grid">
            {SPECIALISATIONS.map((s) => (
              <article key={s.key} className="card card--marketing card--flush spec-card">
                <div className="spec-card__media">
                  <img src={s.image} alt={th.specialisations[s.key].title} width={s.width} height={s.height} loading="lazy" />
                </div>
                <div className="spec-card__body">
                  <h3>{th.specialisations[s.key].title}</h3>
                  <p>{th.specialisations[s.key].text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Founder */}
      <section className="section">
        <div className="container founder">
          <div className="founder__photo">
            <div className="founder__frame">
              <img src="/assets/images/team/founder-white-coat.jpg" alt={th.founderAlt} width={798} height={1492} loading="lazy" />
            </div>
          </div>
          <div className="founder__body">
            <img className="founder__watermark" src="/assets/illustrations/stethoscope-heart.png" alt="" width={556} height={712} loading="lazy" />
            <span className="section-heading__kicker">{th.founderKicker}</span>
            <h2 className="founder__name">{th.founderName}</h2>
            <p className="founder__title">{th.founderTitle}</p>
            <ul className="dot-list">
              {th.credentials.map((c) => <li key={c}>{c}</li>)}
            </ul>
            <div className="cluster">
              <ButtonLink to="/book" variant="primary" icon="calendar">{t.site.bookNow}</ButtonLink>
            </div>
          </div>
        </div>
      </section>

      {/* Latest blog posts (hidden when there are none) */}
      {posts && posts.length > 0 && (
        <section className="section section--subtle">
          <div className="container">
            <SectionHeading kicker={th.blogKicker} title={th.blogTitle} />
            <div className="media-grid">
              {posts.map((p) => <PostCard key={p.id} post={p} />)}
            </div>
            <div className="section-more">
              <ButtonLink to="/blog" variant="secondary" iconEnd="arrow-right">{th.allPosts}</ButtonLink>
            </div>
          </div>
        </section>
      )}

      {/* Call to action */}
      <section className="container" style={{ marginBlockStart: 'var(--section-space)' }}>
        <div className="cta-band">
          <div>
            <h2>{th.ctaTitle}</h2>
            <p>{th.ctaText}</p>
          </div>
          <ButtonLink to="/book" variant="inverse" size="lg" icon="calendar">{t.site.bookNow}</ButtonLink>
        </div>
      </section>
    </>
  );
}
