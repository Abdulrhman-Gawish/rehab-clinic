// Public booking (no login): doctor -> service or package -> date and time -> name and phone -> reference code.
// Nothing is paid online. A picked package is only a request: reception sells it at the desk.
import { useState, type FormEvent } from 'react';
import { act, api, get, notify, qs } from '../api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtTime, fmtWeekday } from '../format';
import { label, useI18n } from '../i18n';
import { usePageTitle } from '../layout/PublicLayout';
import { addDays, dayOfWeek, todayCairo } from '../time';
import {
  Alert, Avatar, Badge, Button, ButtonLink, Card, ChoiceCard, DescriptionList, EmptyState, Field, Icon, IconButton,
  IconCircle, Input, Loading, PageBanner, Stepper,
} from '../ui';
import { Ltr, useLoad } from '../util';
import '../styles/areas/site.css';

const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const;
type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>;
const UTM_STORE = 'rehab-utm';

/**
 * Campaign tags of the link the visitor came from (?utm_source=…&utm_campaign=…). Kept for the browser session, so
 * they survive moving around before booking; a new tagged link replaces them. Only these five values are kept.
 */
function campaignTags(search: string): Utm | undefined {
  const params = new URLSearchParams(search);
  const fromUrl: Utm = {};
  for (const k of UTM_KEYS) {
    const v = params.get(`utm_${k}`)?.trim();
    if (v) fromUrl[k] = v.slice(0, 100);
  }
  try {
    // Before the rename to frontend/: carry the tags of this browser session over once.
    const old = sessionStorage.getItem('playground-utm');
    if (old && !sessionStorage.getItem(UTM_STORE)) sessionStorage.setItem(UTM_STORE, old);
    sessionStorage.removeItem('playground-utm');
    if (Object.keys(fromUrl).length) sessionStorage.setItem(UTM_STORE, JSON.stringify(fromUrl));
    const stored = sessionStorage.getItem(UTM_STORE);
    return stored ? (JSON.parse(stored) as Utm) : undefined;
  } catch {
    return Object.keys(fromUrl).length ? fromUrl : undefined;
  }
}

export function PublicBooking() {
  const { t } = useI18n();
  const tb = t.publicBooking;
  usePageTitle(tb.title);
  const [utm] = useState(() => campaignTags(window.location.search));
  const [doctors] = useLoad(() => get<any[]>('/public/doctors', { noAuth: true }), []);
  const [doctorId, setDoctorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(addDays(todayCairo(), 1));
  const [startAt, setStartAt] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [done, setDone] = useState<any>(null);
  const [step, setStep] = useState(0);
  // '' = no package (pay per session).
  const [packageId, setPackageId] = useState('');
  const [packages] = useLoad(() => get<any[]>('/public/packages', { noAuth: true }), []);
  const doctor = doctors?.find((d) => d.id === doctorId);
  const service = doctor?.services.find((s: any) => s.id === serviceId);
  // Packages this doctor offers (for a service the doctor offers), listed right under the services.
  const offered = (packages ?? []).filter((p) => (p.allDoctors || p.doctors.some((d: any) => d.id === doctorId))
    && doctor?.services.some((s: any) => s.id === p.service.id));
  const pkg = offered.find((p) => p.id === packageId);
  // Picking a service clears the package; picking a package also picks its service.
  const pick = (nextServiceId: string, nextPackageId: string) => {
    setServiceId(nextServiceId); setPackageId(nextPackageId); setStartAt('');
    setStep(2);
  };
  const [slots, , slotsLoading] = useLoad(
    () => (doctorId && serviceId ? get<any[]>(`/public/doctors/${doctorId}/slots${qs({ serviceId, date })}`, { noAuth: true }) : Promise.resolve([])),
    [doctorId, serviceId, date],
  );
  const steps = [tb.steps.doctor, tb.steps.service, tb.steps.time, tb.steps.details];
  const today = todayCairo();

  const [sending, setSending] = useState(false);
  const book = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    await act(async () => setDone(await api('POST', '/public/appointments', { name, phone, doctorId, serviceId, startAt, packageId: packageId || undefined, utm }, { noAuth: true })));
    setSending(false);
  };
  const again = () => { setDone(null); setStartAt(''); setPackageId(''); setStep(serviceId ? 2 : 0); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(done.referenceCode); notify(tb.copied); } catch { /* clipboard blocked: the code stays on screen */ }
  };

  const banner = <PageBanner image="/assets/images/covers/previous-work.webp" title={tb.title} text={tb.subtitle} crumbs={[{ to: '/', label: t.site.home }, { label: tb.title }]} />;

  if (done) {
    return (
      <>
        {banner}
        <div className="booking">
          <Card variant="marketing">
            <div className="booking-done" role="status">
              <IconCircle icon="check-circle" size={72} />
              <h2>{tb.booked}</h2>
              <p className="text-secondary">{tb.bookedText}</p>
              <div className="booking-code">
                <span className="text-body-sm text-muted">{tb.yourCode}</span>
                <span className="booking-code__value"><Ltr>{done.referenceCode}</Ltr></span>
                <IconButton icon="copy" label={tb.copy} onClick={copy} />
              </div>
              <DescriptionList items={[
                [tb.summaryDoctor, done.doctorName],
                [tb.summaryService, done.serviceName],
                [tb.summaryTime, <>{fmtDateTime(done.startAt)} – {fmtTime(done.endAt)}</>],
                [t.fields.status, tb.status(label(t.enums.AppointmentStatus, done.status))],
                done.packageName && [tb.summaryPackage, done.packageName],
              ]} />
              {done.packageName && <Alert tone="info" title={`${tb.packageRequested} ${done.packageName}`}>{tb.packageRequestedHint}</Alert>}
              <div className="cluster" style={{ justifyContent: 'center' }}>
                <Button variant="primary" icon="calendar-plus" onClick={again}>{tb.bookAnother}</Button>
                <ButtonLink to="/" variant="ghost" icon="home">{tb.backHome}</ButtonLink>
              </div>
            </div>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      {banner}
      <div className="booking">
        <Stepper steps={steps} current={step} onStep={setStep} />

        {step === 0 && (
          <Card variant="marketing">
            <h2 className="booking__step-title">{tb.doctorTitle}</h2>
            {!doctors ? <Loading /> : doctors.length === 0 ? <EmptyState icon="stethoscope" title={tb.noDoctors} /> : (
              <div className="choice-grid">
                {doctors.map((d) => (
                  <ChoiceCard
                    key={d.id} name="doctor" checked={doctorId === d.id}
                    onChange={() => { setDoctorId(d.id); setServiceId(''); setStartAt(''); setPackageId(''); setStep(1); }}
                  >
                    <div className="booking-choice__head">
                      <Avatar name={d.name} size={48} />
                      <div>
                        <div className="booking-choice__name">{d.name}</div>
                        <div className="booking-choice__meta">{d.specialty}</div>
                      </div>
                    </div>
                    {d.bio && <p className="booking-choice__bio">{d.bio}</p>}
                  </ChoiceCard>
                ))}
              </div>
            )}
          </Card>
        )}

        {step === 1 && doctor && (
          <Card variant="marketing">
            <h2 className="booking__step-title">{tb.serviceTitle}</h2>
            <h3 className="booking__group-title"><Icon name="clipboard-check" />{tb.singleSessions}</h3>
            <div className="choice-grid">
              {doctor.services.map((s: any) => (
                <ChoiceCard key={s.id} name="service" checked={serviceId === s.id && !packageId} onChange={() => pick(s.id, '')}>
                  <div className="booking-choice__name">{s.name}</div>
                  <div className="booking-choice__meta"><Icon name="clock" size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> {t.common.minutes(fmtNumber(s.durationMinutes))}</div>
                  <div className="booking-choice__price"><strong>{fmtMoney(s.price)}</strong></div>
                </ChoiceCard>
              ))}
            </div>
            {offered.length > 0 && <>
              <h3 className="booking__group-title"><Icon name="package" />{tb.packagesTitle}</h3>
              <div className="choice-grid">
                {offered.map((p) => (
                  <ChoiceCard key={p.id} name="service" checked={packageId === p.id} onChange={() => pick(p.service.id, p.id)}>
                    <div className="spread">
                      <span className="booking-choice__name">{p.name}</span>
                      {p.sellingPrice !== p.price && <Badge tone="accent" icon="tag">{tb.offer}</Badge>}
                    </div>
                    <div className="booking-choice__meta">{tb.packageSessions(fmtNumber(p.sessionsCount), p.service.name)}</div>
                    <div className="booking-choice__price">
                      <strong>{fmtMoney(p.sellingPrice)}</strong>
                      {p.sellingPrice !== p.price && <s>{fmtMoney(p.price)}</s>}
                    </div>
                    {p.sellingPrice !== p.price && p.offerEndsOn && <div className="booking-choice__meta">{tb.offerUntil(fmtDate(p.offerEndsOn))}</div>}
                  </ChoiceCard>
                ))}
              </div>
            </>}
            {packageId && <Alert className="booking__hint" tone="info">{tb.packageHint}</Alert>}
            <div className="booking__nav">
              <Button variant="ghost" icon="arrow-left" onClick={() => setStep(0)}>{tb.back}</Button>
            </div>
          </Card>
        )}

        {step === 2 && serviceId && (
          <Card variant="marketing">
            <h2 className="booking__step-title">{tb.timeTitle}</h2>
            <div className="stack-lg">
              <Field label={t.common.date} hint={`${fmtWeekday(dayOfWeek(date))} · ${fmtDate(date)}`}>
                <div className="input-group">
                  <IconButton
                    icon="chevron-left" label={t.ui.prevDay} variant="outline" size="md" disabled={date <= today}
                    onClick={() => { setDate(addDays(date, -1)); setStartAt(''); }}
                  />
                  <Input type="date" min={today} value={date} onChange={(e) => { setDate(e.target.value); setStartAt(''); }} />
                  <IconButton icon="chevron-right" label={t.ui.nextDay} variant="outline" size="md" onClick={() => { setDate(addDays(date, 1)); setStartAt(''); }} />
                </div>
              </Field>
              {slotsLoading && !slots ? <Loading /> : slots?.length === 0 ? <EmptyState compact icon="clock" title={tb.noFreeSlots} /> : (
                <div className="slots" role="group" aria-label={tb.timeTitle}>
                  {slots?.map((s) => (
                    <button
                      key={s.startAt} type="button" className="slot" aria-pressed={startAt === s.startAt}
                      onClick={() => { setStartAt(s.startAt); setStep(3); }}
                    >
                      {fmtTime(s.startAt)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="booking__nav">
              <Button variant="ghost" icon="arrow-left" onClick={() => setStep(1)}>{tb.back}</Button>
              {startAt && <Button variant="primary" iconEnd="arrow-right" onClick={() => setStep(3)}>{t.common.next}</Button>}
            </div>
          </Card>
        )}

        {step === 3 && startAt && (
          <div className="booking__layout">
            <Card variant="marketing">
              <h2 className="booking__step-title">{tb.detailsTitle}</h2>
              <form className="stack" onSubmit={book}>
                <Field label={tb.name}>
                  <Input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label={tb.phone} hint={tb.phoneHint}>
                  <span className="input-wrap">
                    <Icon name="phone" />
                    <Input type="tel" dir="ltr" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </span>
                </Field>
                <div className="booking__nav">
                  <Button variant="ghost" icon="arrow-left" onClick={() => setStep(2)}>{tb.back}</Button>
                  <Button type="submit" variant="primary" size="lg" icon="calendar-check" loading={sending} disabled={!name.trim() || !phone.trim()}>{tb.book}</Button>
                </div>
              </form>
            </Card>
            <aside className="booking__aside">
              <Card title={tb.summary} icon="calendar" variant="muted">
                <div className="stack">
                  <DescriptionList items={[
                    [tb.summaryDoctor, doctor?.name],
                    pkg ? [tb.summaryPackage, pkg.name] : [tb.summaryService, service?.name],
                    [tb.summaryTime, <>{fmtWeekday(dayOfWeek(date))} {fmtDate(date)} · {fmtTime(startAt)}</>],
                    [tb.summaryPrice, pkg ? fmtMoney(pkg.sellingPrice) : service && fmtMoney(service.price)],
                  ]} />
                  <p className="text-body-sm text-muted">{pkg ? tb.packageHint : tb.payAtClinic}</p>
                </div>
              </Card>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}
