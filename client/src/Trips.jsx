import React, { useEffect, useRef, useState } from 'react';
import './trips.css';

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
const cents = value => Math.round(value * 100);
const dateLabel = date => new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function Trips({ request, onExpired }) {
  const [trips, setTrips] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [modal, setModal] = useState(null);
  useEffect(() => { let active = true; request('/trips').then(data => { if (active) setTrips(data); }).catch(e => { if (active) { setError(e.message); if (e.status === 401) onExpired(); } }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  async function retry() { setLoading(true); setError(''); try { setTrips(await request('/trips')); } catch (e) { setError(e.message); if (e.status === 401) onExpired(); } finally { setLoading(false); } }
  async function save(values) {
    setBusy(true); setError(''); setNotice('');
    try {
      const trip = modal.trip;
      if (modal.kind === 'delete') {
        await request('/trips/' + trip.id, { method: 'DELETE' });
        setTrips(list => list.filter(t => t.id !== trip.id)); setNotice('Trip removed.');
      } else {
        const url = '/trips' + (trip ? '/' + trip.id : '') + (modal.kind === 'savings' ? '/savings' : '');
        const result = await request(url, { method: modal.kind === 'edit' ? 'PUT' : 'POST', body: values });
        setTrips(list => trip ? list.map(t => t.id === trip.id ? result : t) : [result, ...list]);
        setNotice(modal.kind === 'savings' ? 'A little closer to your next adventure.' : 'Trip goal saved.');
      }
      setModal(null);
    } catch (e) { setError(e.message); if (e.status === 401) onExpired(); }
    finally { setBusy(false); }
  }
  const total = trips.reduce((sum, trip) => ({ budget: sum.budget + cents(trip.budget), saved: sum.saved + cents(trip.saved), pending: sum.pending + Math.max(0, cents(trip.budget) - cents(trip.saved)) }), { budget: 0, saved: 0, pending: 0 });
  return <section className="tripsSection" aria-labelledby="trips-title">
    <div className="tripSectionHeading"><div><div className="eyebrow">SOMETHING TO LOOK FORWARD TO</div><h2 id="trips-title">A little saved. <span>A world to explore.</span></h2><p>Your next adventure starts with a plan.</p></div><button className="primary" disabled={loading || busy || (!!error && !modal)} onClick={() => { setError(''); setModal({ kind: 'new' }); }}>+ Plan a trip</button></div>
    <div className="tripScope">Trip goals carry across months. These are amounts you’ve set aside; they don’t change your monthly balance.</div>
    {error && !modal && <div className="error banner" role="alert">{error}<button onClick={retry}>Retry</button></div>}
    {notice && <p className="tripNotice" role="status">✓ {notice}</p>}
    {loading ? <div className="panel tripEmpty" aria-busy="true"><p>Opening your travel plans…</p></div> : trips.length ? <>
      <div className="tripTotals"><div><span>TRAVEL BUDGET</span><strong>{money(total.budget / 100)}</strong></div><div><span>ALREADY SET ASIDE</span><strong>{money(total.saved / 100)}</strong></div><div><span>STILL TO SAVE</span><strong>{money(total.pending / 100)}</strong></div><span className="tripCount">{trips.length} {trips.length === 1 ? 'adventure' : 'adventures'} in the making ↗</span></div>
      <div className="tripGrid">{trips.map((trip, index) => {
        const remaining = Math.max(0, cents(trip.budget) - cents(trip.saved)) / 100, complete = remaining === 0;
        const percent = Math.min(100, Math.floor(cents(trip.saved) / cents(trip.budget) * 100));
        const extra = Math.max(0, cents(trip.saved) - cents(trip.budget)) / 100;
        return <article className={'panel tripCard tripTheme' + index % 3} key={trip.id}>
          <div className="tripLandscape" aria-hidden="true"><div className="tripSun"/><div className="tripHill hillBack"/><div className="tripHill hillFront"/><span className="tripPlane">✈</span><span className="tripStamp">POCKET EXPLORER<br/><b>{String(index + 1).padStart(2, '0')}</b></span></div>
          <div className="tripCardBody"><div className="tripCardHeading"><div><span className="tripDate">{trip.targetDate ? dateLabel(trip.targetDate) : 'YOUR NEXT GETAWAY'}</span><h3>{trip.name}</h3></div><span className={'tripStatus' + (complete ? ' funded' : '')}>{complete ? '✓ Fully funded' : 'Saving up'}</span></div>
            <div className="tripSaved"><strong>{money(trip.saved)}</strong><span>saved of {money(trip.budget)}</span></div>
            <div className="tripProgressLabel"><span>{complete ? 'Adventure, here you come.' : 'Every little bit gets you closer.'}</span><b>{percent}%</b></div>
            <progress className="tripProgress" max="100" value={percent} aria-label={`${trip.name} savings progress`}>{percent}%</progress>
            <div className="tripPending"><span>{extra ? 'A little extra for the journey' : 'Left to save'}</span><strong>{money(extra || remaining)}</strong></div>
            <div className="tripActions"><button className="primary" disabled={busy} onClick={() => { setError(''); setModal({ kind: 'savings', trip }); }}>+ Add savings</button><button className="textBtn" disabled={busy} onClick={() => { setError(''); setModal({ kind: 'edit', trip }); }} aria-label={'Edit ' + trip.name}>Edit goal</button><button className="tripRemove" disabled={busy} onClick={() => { setError(''); setModal({ kind: 'delete', trip }); }} aria-label={'Delete ' + trip.name}>×</button></div>
          </div>
        </article>;
      })}</div>
    </> : !error && <div className="panel tripEmpty"><span className="tripEmptyIcon" aria-hidden="true">✈</span><div><h3>Where would you love to go?</h3><p>A weekend away or the trip of a lifetime.<br/>Give it a budget and watch your savings take you there.</p><button className="primary" onClick={() => setModal({ kind: 'new' })}>Create your first trip ↗</button></div><span className="tripEmptyDecor" aria-hidden="true">✦</span></div>}
    {modal && <TripDialog key={modal.kind + (modal.trip?.id || '')} modal={modal} busy={busy} error={error} onClose={() => { if (!busy) { setModal(null); setError(''); } }} onSave={save}/>}
  </section>;
}

function TripDialog({ modal, busy, error, onClose, onSave }) {
  const ref = useRef(), trip = modal.trip;
  const [values, setValues] = useState({ name: trip?.name || '', budget: trip?.budget ?? '', saved: trip?.saved ?? 0, targetDate: trip?.targetDate || '' }), [addition, setAddition] = useState('');
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  function submit(event) { event.preventDefault(); onSave(modal.kind === 'savings' ? { amount: Number(addition) } : { ...values, name: values.name.trim(), budget: Number(values.budget), saved: Number(values.saved) }); }
  const set = key => event => setValues(v => ({ ...v, [key]: event.target.value }));
  const title = { new: 'Plan your next adventure', edit: 'Edit your trip goal', savings: 'One step closer', delete: 'Remove this trip?' }[modal.kind];
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="trip-dialog-title"><div className="dialogHead"><h2 id="trip-dialog-title">{title}</h2><button type="button" aria-label="Close" disabled={busy} onClick={onClose}>×</button></div>
    {modal.kind === 'delete' ? <><p>Remove “{trip.name}” and its savings goal? This only removes the tracker; no money is moved.</p>{error && <p className="error" role="alert">{error}</p>}<div className="modalButtons"><button disabled={busy} onClick={onClose}>Keep trip</button><button className="primary" disabled={busy} onClick={() => onSave()}>{busy ? 'Removing…' : 'Remove trip'}</button></div></> : <form onSubmit={submit}><fieldset disabled={busy}>
      {modal.kind === 'savings' ? <><p>You’ve set aside {money(trip.saved)} for <strong>{trip.name}</strong>.</p><label htmlFor="trip-addition">How much are you adding? (₹)</label><input id="trip-addition" type="number" min="0.01" max="1000000000" step="0.01" value={addition} onChange={e => setAddition(e.target.value)} autoFocus required/><small className="hint">Records money you’ve already set aside for this trip.</small></> : <><label htmlFor="trip-name">Trip name or destination</label><input id="trip-name" value={values.name} onChange={set('name')} placeholder="e.g. A week in Bali" maxLength={80} required autoFocus/><div className="tripFormRow"><div><label htmlFor="trip-budget">Total budget (₹)</label><input id="trip-budget" type="number" min="0.01" max="1000000000" step="0.01" value={values.budget} onChange={set('budget')} required/></div><div><label htmlFor="trip-saved">Already saved (₹)</label><input id="trip-saved" type="number" min="0" max="1000000000" step="0.01" value={values.saved} onChange={set('saved')} required/></div></div><label htmlFor="trip-date">Travel date <span className="optional">(optional)</span></label><input id="trip-date" type="date" value={values.targetDate} onChange={set('targetDate')}/><small className="hint">You can update your budget or saved total anytime.</small></>}
      {error && <p className="error" role="alert">{error}</p>}<button className="primary">{busy ? 'Saving…' : modal.kind === 'savings' ? 'Add to trip savings ↗' : 'Save trip goal ↗'}</button>
    </fieldset></form>}
  </dialog>;
}
