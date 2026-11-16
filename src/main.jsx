import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { QRCodeSVG } from 'qrcode.react';
import * as XLSX from 'xlsx';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const newId = () => crypto.randomUUID();
const slug = () => crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const errText = (e) => e?.message || String(e || 'Errore sconosciuto');
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function Brand() {
  return <header className="brand"><span className="brand-mark">ABB</span><span className="brand-title">Live interaction</span><span className="brand-spacer"/><span className="brand-tag">Engineered to Outrun</span></header>;
}
function Notice({ children, kind = '' }) { return children ? <div className={`notice ${kind}`}>{children}</div> : null; }
function Button({ children, className = '', ...props }) { return <button className={`button ${className}`} {...props}>{children}</button>; }
function downloadJson(data, name) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function respondentId(eventSlug) {
  const key = `abb-live-respondent-${eventSlug}`;
  let value = localStorage.getItem(key);
  if (!value) { value = newId(); localStorage.setItem(key, value); }
  return value;
}
function answerToText(value) {
  if (Array.isArray(value)) return value.join(' | ');
  if (value === null || value === undefined) return '';
  return String(value);
}
function imageStyle(settings = {}) {
  const fit = settings.image_fit === 'cover' ? 'cover' : 'contain';
  const x = Number.isFinite(Number(settings.image_x)) ? Number(settings.image_x) : 50;
  const y = Number.isFinite(Number(settings.image_y)) ? Number(settings.image_y) : 50;
  return { objectFit: fit, objectPosition: `${x}% ${y}%` };
}

function App() {
  const joinSlug = new URLSearchParams(window.location.search).get('join');
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [responses, setResponses] = useState({});
  const [audienceQuestions, setAudienceQuestions] = useState([]);
  const [voteCounts, setVoteCounts] = useState({});
  const [participantAnswers, setParticipantAnswers] = useState({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [questionDraft, setQuestionDraft] = useState(emptyQuestion());
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const [qaText, setQaText] = useState('');
  const [participantStatus, setParticipantStatus] = useState('loading');
  const [participantEvent, setParticipantEvent] = useState(null);
  const isParticipant = Boolean(joinSlug);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession); setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadEvents = useCallback(async () => {
    if (!supabase || !session) return;
    const { data, error } = await supabase.from('events').select('*').order('created_at', { ascending: false });
    if (error) setNotice(errText(error)); else setEvents(data || []);
  }, [session]);

  useEffect(() => { if (session && !isParticipant) loadEvents(); }, [session, isParticipant, loadEvents]);

  const loadEventData = useCallback(async (event) => {
    if (!supabase || !event) return;
    const [{ data: qs, error: qe }, { data: as, error: ae }, { data: rs, error: re }] = await Promise.all([
      supabase.from('questions').select('*').eq('event_id', event.id).order('position', { ascending: true }),
      supabase.from('audience_questions').select('*').eq('event_id', event.id).order('created_at', { ascending: true }),
      supabase.from('responses').select('question_id,answer,elapsed_seconds,created_at,respondent_id').in('question_id', await getQuestionIds(event.id))
    ]);
    if (qe || ae || re) { setNotice(errText(qe || ae || re)); return; }
    setQuestions(qs || []);
    const byQuestion = {};
    for (const r of (rs || [])) (byQuestion[r.question_id] ||= []).push(r);
    setResponses(byQuestion);
    setAudienceQuestions(as || []);
    const voteMap = {};
    const approved = (as || []).filter(item => item.status === 'approved');
    if (approved.length) {
      const { data: votes, error: ve } = await supabase.from('question_votes').select('audience_question_id').in('audience_question_id', approved.map(x => x.id));
      if (!ve) for (const v of (votes || [])) voteMap[v.audience_question_id] = (voteMap[v.audience_question_id] || 0) + 1;
    }
    setVoteCounts(voteMap);
  }, []);

  // Fetch question IDs independently first: empty .in() is avoided.
  async function getQuestionIds(eventId) {
    const { data, error } = await supabase.from('questions').select('id').eq('event_id', eventId);
    if (error) throw error;
    return (data || []).map(x => x.id);
  }

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const refresh = async () => { if (!cancelled) { await loadEventData(selected); await loadEvents(); } };
    refresh();
    const timer = setInterval(refresh, 3500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [selected, loadEventData, loadEvents]);

  const loadParticipant = useCallback(async () => {
    if (!supabase || !joinSlug) return;
    const { data: event, error } = await supabase.from('events').select('*').eq('slug', joinSlug).eq('status', 'live').maybeSingle();
    if (error || !event) { setParticipantEvent(null); setParticipantStatus('unavailable'); return; }
    const { data: qs, error: qError } = await supabase.from('questions').select('*').eq('event_id', event.id).eq('is_open', true).order('position', { ascending: true });
    if (qError) { setNotice(errText(qError)); return; }
    setParticipantEvent({ ...event, questions: qs || [] });
    setParticipantStatus('ready');
  }, [joinSlug]);

  useEffect(() => {
    if (!isParticipant) return;
    loadParticipant();
    const timer = setInterval(loadParticipant, 3500);
    return () => clearInterval(timer);
  }, [isParticipant, loadParticipant]);

  async function signIn(e) {
    e.preventDefault(); setNotice(''); setBusy(true);
    const result = authMode === 'signup'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) setNotice(errText(result.error));
    else if (authMode === 'signup' && !result.data.session) setNotice('Registrazione inviata. Controlla la casella email per confermare l’account.');
    else setNotice('Accesso effettuato.');
  }

  async function createEvent(e) {
    e.preventDefault(); if (!session) return;
    const title = eventTitle.trim(); if (!title) return;
    setBusy(true);
    const { data, error } = await supabase.from('events').insert({ owner_id: session.user.id, title, slug: slug(), status: 'draft', settings: { qa_enabled: true, image_fit: 'contain', image_x: 50, image_y: 50 } }).select('*').single();
    setBusy(false);
    if (error) setNotice(errText(error)); else { setEventTitle(''); setSelected(data); setNotice('Evento creato. Aggiungi e verifica le domande prima di avviarlo.'); }
  }

  function startEditQuestion(q) {
    setEditingQuestionId(q.id);
    setQuestionDraft({ prompt: q.prompt, type: q.type, options: Array.isArray(q.options) ? q.options.join('\n') : '', is_required: Boolean(q.is_required), is_open: Boolean(q.is_open) });
    document.getElementById('question-editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function emptyQuestion() { return { prompt: '', type: 'single', options: 'Sì\nNo', is_required: false, is_open: true }; }

  async function saveQuestion(e) {
    e.preventDefault(); if (!selected) return;
    const prompt = questionDraft.prompt.trim();
    if (!prompt) { setNotice('Scrivi il testo della domanda.'); return; }
    let options = [];
    if (['single', 'multiple'].includes(questionDraft.type)) {
      options = questionDraft.options.split('\n').map(x => x.trim()).filter(Boolean);
      if (options.length < 2) { setNotice('Inserisci almeno due opzioni, una per riga.'); return; }
    }
    const current = questions.find(q => q.id === editingQuestionId);
    const payload = { prompt, type: questionDraft.type, options, is_required: Boolean(questionDraft.is_required), is_open: Boolean(questionDraft.is_open), position: current?.position ?? questions.length, updated_at: new Date().toISOString() };
    setBusy(true);
    const result = editingQuestionId
      ? await supabase.from('questions').update(payload).eq('id', editingQuestionId).select().single()
      : await supabase.from('questions').insert({ ...payload, event_id: selected.id }).select().single();
    setBusy(false);
    if (result.error) setNotice(errText(result.error));
    else { setNotice(editingQuestionId ? 'Domanda aggiornata.' : 'Domanda aggiunta.'); setEditingQuestionId(null); setQuestionDraft(emptyQuestion()); await loadEventData(selected); }
  }

  async function toggleQuestion(q) {
    const { error } = await supabase.from('questions').update({ is_open: !q.is_open, updated_at: new Date().toISOString() }).eq('id', q.id);
    if (error) setNotice(errText(error)); else { setNotice(q.is_open ? 'Domanda messa in pausa.' : 'Domanda riattivata.'); await loadEventData(selected); }
  }
  async function deleteQuestion(q) {
    if (!window.confirm('Eliminare questa domanda e tutte le risposte associate?')) return;
    const { error } = await supabase.from('questions').delete().eq('id', q.id);
    if (error) setNotice(errText(error)); else { setNotice('Domanda eliminata.'); await loadEventData(selected); }
  }
  async function moveQuestion(index, delta) {
    const target = index + delta; if (target < 0 || target >= questions.length) return;
    const reordered = [...questions]; [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const updates = await Promise.all(reordered.map((q, i) => supabase.from('questions').update({ position: i }).eq('id', q.id)));
    const failure = updates.find(x => x.error);
    if (failure) setNotice(errText(failure.error)); else await loadEventData(selected);
  }

  async function updateEvent(patch) {
    const next = { ...selected, ...patch, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('events').update(patch).eq('id', selected.id);
    if (error) setNotice(errText(error)); else { setSelected(next); setNotice('Evento aggiornato.'); await loadEvents(); }
  }

  async function setEventStatus(status) {
    if (status === 'closed' && !window.confirm('Chiudere l’evento? Potrai comunque esportare i dati dopo la chiusura.')) return;
    if (status === 'live' && !window.confirm('Avviare l’evento? Chiunque abbia il QR o il link potrà partecipare.')) return;
    await updateEvent({ status });
  }

  async function uploadImage(file) {
    if (!selected || !file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setNotice('Formato non supportato. Usa JPG, PNG o WebP.'); return; }
    if (file.size > 20 * 1024 * 1024) { setNotice('Immagine troppo grande: massimo 20 MB.'); return; }
    setBusy(true);
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
    const path = `${selected.id}/${newId()}.${extension}`;
    const { error } = await supabase.storage.from('event-images').upload(path, file, { contentType: file.type, upsert: false });
    if (error) { setBusy(false); setNotice(errText(error)); return; }
    const { data: publicData } = supabase.storage.from('event-images').getPublicUrl(path);
    const settings = { ...(selected.settings || {}), image_path: path, image_url: publicData.publicUrl };
    const { error: saveError } = await supabase.from('events').update({ settings }).eq('id', selected.id);
    setBusy(false);
    if (saveError) setNotice(errText(saveError));
    else { setSelected({ ...selected, settings }); setNotice('Immagine caricata. L’originale resta nello Storage; l’adattamento cambia solo la visualizzazione.'); }
  }

  async function removeEventImage() {
    const path = selected?.settings?.image_path;
    if (!path) return;
    if (!window.confirm('Rimuovere l’immagine dell’evento?')) return;
    const { error } = await supabase.storage.from('event-images').remove([path]);
    if (error) { setNotice(`Impossibile rimuovere il file: ${errText(error)}. Verifica la policy Storage.`); return; }
    const settings = { ...(selected.settings || {}) }; delete settings.image_path; delete settings.image_url;
    await updateEvent({ settings });
  }

  async function submitAnswer(q) {
    const value = participantAnswers[q.id];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
    if (empty && q.is_required) { setNotice('Questa domanda è obbligatoria: inserisci una risposta.'); return; }
    if (empty) { setNotice('Seleziona o inserisci una risposta prima di inviare.'); return; }
    if (typeof value === 'string' && value.trim() === '') { setNotice('Inserisci una risposta.'); return; }
    setBusy(true); setNotice('');
    const key = `abb-live-done-${joinSlug}-${q.id}`;
    const started = Number(sessionStorage.getItem(`abb-live-start-${joinSlug}-${q.id}`) || Date.now());
    const elapsed = Math.max(0, Math.round((Date.now() - started) / 1000));
    const { error } = await supabase.from('responses').insert({ question_id: q.id, respondent_id: respondentId(joinSlug), answer: value, elapsed_seconds: elapsed });
    setBusy(false);
    if (error) {
      setNotice(error.code === '23505' ? 'Hai già inviato una risposta a questa domanda da questo browser.' : errText(error));
    } else {
      localStorage.setItem(key, '1');
      setNotice('Risposta inviata. Grazie.');
      setParticipantAnswers(prev => ({ ...prev, [q.id]: undefined }));
    }
  }

  async function submitAudienceQuestion(e) {
    e.preventDefault(); const body = qaText.trim(); if (!body || !participantEvent) return;
    setBusy(true);
    const { error } = await supabase.from('audience_questions').insert({ event_id: participantEvent.id, respondent_id: respondentId(joinSlug), body, status: 'pending' });
    setBusy(false);
    if (error) setNotice(errText(error)); else { setQaText(''); setNotice('Domanda inviata al moderatore.'); }
  }

  async function voteForQuestion(aq) {
    const key = `abb-live-voted-${joinSlug}-${aq.id}`;
    if (localStorage.getItem(key)) { setNotice('Hai già votato per questa domanda da questo browser.'); return; }
    const { error } = await supabase.from('question_votes').insert({ audience_question_id: aq.id, respondent_id: respondentId(joinSlug) });
    if (error) setNotice(error.code === '23505' ? 'Hai già votato per questa domanda.' : errText(error));
    else { localStorage.setItem(key, '1'); setNotice('Voto registrato.'); }
  }

  async function moderate(aq, status) {
    const result = status === 'delete'
      ? await supabase.from('audience_questions').delete().eq('id', aq.id)
      : await supabase.from('audience_questions').update({ status }).eq('id', aq.id);
    if (result.error) setNotice(errText(result.error));
    else setNotice(status === 'approved' ? 'Domanda Q&A approvata.' : status === 'rejected' ? 'Domanda rifiutata.' : status === 'delete' ? 'Domanda eliminata.' : 'Domanda rimessa in attesa.');
    if (!result.error) await loadEventData(selected);
  }

  async function exportWorkbook() {
    if (!selected) return;
    const ids = questions.map(q => q.id);
    let allResponses = [];
    if (ids.length) {
      const { data, error } = await supabase.from('responses').select('*').in('question_id', ids).order('created_at');
      if (error) { setNotice(errText(error)); return; }
      allResponses = data || [];
    }
    const { data: qaRows, error: qaError } = await supabase.from('audience_questions').select('*').eq('event_id', selected.id).order('created_at');
    if (qaError) { setNotice(errText(qaError)); return; }
    const qaIds = (qaRows || []).map(x => x.id);
    let voteRows = [];
    if (qaIds.length) {
      const { data, error } = await supabase.from('question_votes').select('*').in('audience_question_id', qaIds);
      if (error) { setNotice(errText(error)); return; }
      voteRows = data || [];
    }
    const byQuestion = {};
    allResponses.forEach(r => (byQuestion[r.question_id] ||= []).push(r));
    const summary = questions.map(q => {
      const rows = byQuestion[q.id] || [];
      const counts = {};
      rows.forEach(r => { const key = answerToText(r.answer); counts[key] = (counts[key] || 0) + 1; });
      return { Domanda: q.prompt, Tipo: q.type, Attiva: q.is_open ? 'Sì' : 'No', Risposte: rows.length, 'Dettaglio conteggi': Object.entries(counts).map(([a, n]) => `${a}: ${n}`).join(' | ') };
    });
    const answerSheet = allResponses.map(r => ({
      Domanda: questions.find(q => q.id === r.question_id)?.prompt || '',
      Tipo: questions.find(q => q.id === r.question_id)?.type || '',
      ID_anonimo_browser: r.respondent_id,
      Risposta: answerToText(r.answer),
      Tempo_stimato_secondi: r.elapsed_seconds ?? '',
      Data_ora_UTC: r.created_at
    }));
    const qaSheet = (qaRows || []).map(q => ({
      Domanda: q.body,
      Stato: q.status,
      Voti: voteRows.filter(v => v.audience_question_id === q.id).length,
      ID_anonimo_browser: q.respondent_id,
      Data_ora_UTC: q.created_at
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary.length ? summary : [{ Nota: 'Nessuna domanda' }]), 'Sintesi');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(answerSheet.length ? answerSheet : [{ Nota: 'Nessuna risposta' }]), 'Risposte');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(qaSheet.length ? qaSheet : [{ Nota: 'Nessuna domanda Q&A' }]), 'Q&A');
    XLSX.writeFile(wb, `${selected.slug}-risultati.xlsx`);
    setNotice('Export Excel scaricato. Conservalo prima di cancellare l’evento.');
  }

  async function exportTemplate() {
    if (!selected) return;
    downloadJson({ format: 'abb-live-template-v1', title: selected.title, settings: selected.settings || {}, questions: questions.map(({ prompt, type, options, position, is_open, is_required }) => ({ prompt, type, options, position, is_open, is_required })) }, `${selected.slug}-template.json`);
  }

  async function importTemplate(file) {
    if (!file || !selected) return;
    try {
      const template = JSON.parse(await file.text());
      if (template.format !== 'abb-live-template-v1' || !Array.isArray(template.questions)) throw new Error('Il file non è un modello ABB Live Interaction riconosciuto.');
      if (!window.confirm(`Importare ${template.questions.length} domande? Le domande attuali resteranno e verranno aggiunte quelle importate.`)) return;
      const inserts = template.questions.map((q, i) => ({ event_id: selected.id, prompt: String(q.prompt || '').slice(0, 2000), type: q.type, options: Array.isArray(q.options) ? q.options : [], position: questions.length + i, is_open: Boolean(q.is_open), is_required: Boolean(q.is_required) }));
      if (inserts.some(q => !q.prompt || !['single', 'multiple', 'open', 'rating'].includes(q.type))) throw new Error('Il modello contiene una domanda non valida.');
      const { error } = await supabase.from('questions').insert(inserts);
      if (error) throw error;
      setNotice('Domande del modello importate. L’immagine non è inclusa nel JSON.'); await loadEventData(selected);
    } catch (error) { setNotice(errText(error)); }
  }

  async function deleteEvent() {
    if (!selected) return;
    if (!window.confirm('Hai già scaricato l’Excel? Eliminare l’evento elimina anche domande e risposte. Continuare?')) return;
    if (!window.confirm('Conferma finale: cancellare questo evento?')) return;
    const path = selected.settings?.image_path;
    if (path) {
      const { error: storageError } = await supabase.storage.from('event-images').remove([path]);
      if (storageError) { setNotice(`Eliminazione interrotta: prima rimuovi l’immagine dallo Storage (${errText(storageError)}).`); return; }
    }
    const { error } = await supabase.from('events').delete().eq('id', selected.id);
    if (error) setNotice(errText(error)); else { setSelected(null); setQuestions([]); setResponses({}); setAudienceQuestions([]); setNotice('Evento e dati eliminati dal database. Verifica separatamente la conservazione dei backup del provider.'); await loadEvents(); }
  }

  function renderParticipant() {
    if (!supabase) return <main><Brand/><section className="card"><h1>Configurazione mancante</h1><p>Configura URL e publishable key Supabase per usare l’app.</p></section></main>;
    const event = participantEvent;
    return <main className="page participant-page"><Brand/>
      {participantStatus === 'loading' && <p>Caricamento evento…</p>}
      {participantStatus === 'unavailable' && <section className="card"><h1>Evento non disponibile</h1><p>Controlla il QR o chiedi all’organizzatore di avviare l’evento.</p></section>}
      {event && <>
        <section className="card participant-head">
          {event.settings?.image_url && <img className="event-image" src={event.settings.image_url} alt="Immagine dell’evento" style={imageStyle(event.settings)} />}
          <p className="eyebrow">Evento live</p><h1>{event.title}</h1><p>Risposte anonime tramite identificativo casuale del browser. Non inserire dati personali.</p>
        </section>
        {event.questions.length === 0 && <section className="card"><p>Non ci sono domande attive in questo momento.</p></section>}
        {event.questions.map(q => <ParticipantQuestion key={q.id} q={q} answers={participantAnswers} setAnswers={setParticipantAnswers} onSubmit={submitAnswer} disabled={busy} eventSlug={joinSlug} />)}
        {event.settings?.qa_enabled !== false && <AudienceQAParticipant event={event} value={qaText} setValue={setQaText} onSubmit={submitAudienceQuestion} busy={busy} />}
      </>}
      <Notice>{notice}</Notice>
      <footer>Prototipo · Dati anonimi basati sul browser, non identificazione verificata.</footer>
    </main>;
  }

  if (!supabase) return <main className="page"><Brand/><section className="card"><h1>Configurazione Supabase mancante</h1><p>Definisci VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY nella build.</p></section></main>;
  if (isParticipant) return renderParticipant();

  return <main className="page"><Brand/>
    {!authReady && <p>Caricamento…</p>}
    {authReady && !session && <section className="card auth-card">
      <p className="eyebrow">Console organizzatore</p><h1>{authMode === 'login' ? 'Accedi' : 'Crea account'}</h1>
      <form onSubmit={signIn} className="stack">
        <label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength="8" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        <Button disabled={busy}>{busy ? 'Attendi…' : authMode === 'login' ? 'Accedi' : 'Registrati'}</Button>
      </form>
      <button className="text-button" onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setNotice(''); }}>{authMode === 'login' ? 'Primo accesso? Crea un account' : 'Hai già un account? Accedi'}</button>
      <Notice>{notice}</Notice>
    </section>}
    {session && <>
      <div className="topline"><div><p className="eyebrow">Console organizzatore</p><h1>I tuoi eventi</h1></div><Button className="secondary" onClick={() => supabase.auth.signOut()}>Esci</Button></div>
      {!selected && <>
        <form className="create-event card" onSubmit={createEvent}><div><label htmlFor="event-title">Nome evento</label><input id="event-title" value={eventTitle} onChange={e => setEventTitle(e.target.value)} maxLength={200} placeholder="Es. Town hall — Milano" required /></div><Button disabled={busy}>Crea evento</Button></form>
        <div className="event-list">{events.length === 0 ? <section className="card"><p>Non hai ancora eventi. Crea il primo qui sopra.</p></section> : events.map(ev => <button key={ev.id} className="event-list-item" onClick={() => { setSelected(ev); setNotice(''); }}><span><strong>{ev.title}</strong><small>{ev.created_at ? new Date(ev.created_at).toLocaleString() : ''}</small></span><span className={`status status-${ev.status}`}>{ev.status}</span></button>)}</div>
      </>}
      {selected && <>
        <Button className="text-button back-button" onClick={() => { setSelected(null); setNotice(''); }}>← Tutti gli eventi</Button>
        <div className="topline"><div><p className="eyebrow">Gestione evento</p><h1>{selected.title}</h1></div><span className={`status status-${selected.status}`}>{selected.status}</span></div>
        <section className="card event-controls">
          <div className="toolbar"><Button onClick={() => setEventStatus(selected.status === 'live' ? 'closed' : 'live')}>{selected.status === 'live' ? 'Chiudi evento' : selected.status === 'closed' ? 'Riapri evento' : 'Avvia evento'}</Button><Button className="secondary" onClick={exportWorkbook}>Esporta Excel</Button><Button className="secondary" onClick={exportTemplate}>Esporta modello JSON</Button><label className="button secondary file-button">Importa modello JSON<input type="file" accept="application/json,.json" onChange={e => { importTemplate(e.target.files?.[0]); e.target.value = ''; }} /></label><Button className="danger" onClick={deleteEvent}>Elimina evento e dati</Button></div>
          <label>Titolo evento<input value={selected.title} maxLength={200} onChange={e => setSelected({ ...selected, title: e.target.value })} onBlur={() => updateEvent({ title: selected.title.trim() })} /></label>
          <label className="check-label"><input type="checkbox" checked={selected.settings?.qa_enabled !== false} onChange={e => updateEvent({ settings: { ...(selected.settings || {}), qa_enabled: e.target.checked } })} /> Abilita Q&amp;A pubblico</label>
        </section>
        <section className="card"><h2>Immagine evento</h2><p className="muted">Carichiamo l’originale senza ricomprimerlo. Adattamento e posizione cambiano solo la visualizzazione. Max 20 MB; JPG, PNG o WebP.</p>
          {selected.settings?.image_url && <><img className="event-image preview-image" src={selected.settings.image_url} alt="Anteprima" style={imageStyle(selected.settings)} /><div className="image-controls"><label>Adattamento<select value={selected.settings.image_fit || 'contain'} onChange={e => updateEvent({ settings: { ...selected.settings, image_fit: e.target.value } })}><option value="contain">Mostra immagine intera</option><option value="cover">Riempi e ritaglia la visualizzazione</option></select></label><label>Posizione orizzontale<input type="range" min="0" max="100" value={selected.settings.image_x ?? 50} onChange={e => updateEvent({ settings: { ...selected.settings, image_x: Number(e.target.value) } })} /></label><label>Posizione verticale<input type="range" min="0" max="100" value={selected.settings.image_y ?? 50} onChange={e => updateEvent({ settings: { ...selected.settings, image_y: Number(e.target.value) } })} /></label><Button className="danger" onClick={removeEventImage}>Rimuovi immagine</Button></div></>}
          <label className="file-label">Carica o sostituisci immagine<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { uploadImage(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </section>
        <section className="card"><h2>QR partecipanti</h2><p>Il QR funziona quando l’evento è online e avviato.</p><div className="qr-layout"><QRCodeSVG value={`${window.location.origin}${window.location.pathname}?join=${selected.slug}`} size={190} level="M" includeMargin /><div><code className="url-box">{`${window.location.origin}${window.location.pathname}?join=${selected.slug}`}</code><Button className="secondary" onClick={() => navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?join=${selected.slug}`).then(() => setNotice('Link copiato.'))}>Copia link partecipanti</Button></div></div></section>
        <section className="card" id="question-editor"><h2>{editingQuestionId ? 'Modifica domanda' : 'Aggiungi domanda'}</h2><form className="stack" onSubmit={saveQuestion}>
          <label>Testo domanda<input value={questionDraft.prompt} onChange={e => setQuestionDraft({ ...questionDraft, prompt: e.target.value })} maxLength={2000} required placeholder="Scrivi la domanda" /></label>
          <label>Tipo<select value={questionDraft.type} onChange={e => setQuestionDraft({ ...questionDraft, type: e.target.value })}><option value="single">Scelta singola</option><option value="multiple">Scelta multipla</option><option value="open">Risposta aperta</option><option value="rating">Valutazione da 1 a 5</option></select></label>
          {['single', 'multiple'].includes(questionDraft.type) && <label>Opzioni — una per riga<textarea rows="4" value={questionDraft.options} onChange={e => setQuestionDraft({ ...questionDraft, options: e.target.value })} required /></label>}
          <label className="check-label"><input type="checkbox" checked={questionDraft.is_required} onChange={e => setQuestionDraft({ ...questionDraft, is_required: e.target.checked })} /> Obbligatoria</label>
          <label className="check-label"><input type="checkbox" checked={questionDraft.is_open} onChange={e => setQuestionDraft({ ...questionDraft, is_open: e.target.checked })} /> Attiva per i partecipanti</label>
          <div className="toolbar"><Button disabled={busy}>{editingQuestionId ? 'Salva modifiche' : 'Aggiungi domanda'}</Button>{editingQuestionId && <Button className="secondary" type="button" onClick={() => { setEditingQuestionId(null); setQuestionDraft(emptyQuestion()); }}>Annulla modifica</Button>}</div>
        </form></section>
        <section className="section-heading"><h2>Domande e risultati live</h2><span>{questions.length} domande</span></section>
        {questions.map((q, index) => <QuestionCard key={q.id} q={q} index={index} total={questions.length} rows={responses[q.id] || []} onEdit={() => startEditQuestion(q)} onToggle={() => toggleQuestion(q)} onDelete={() => deleteQuestion(q)} onMove={d => moveQuestion(index, d)} />)}
        <section className="card"><h2>Moderazione Q&amp;A</h2><p className="muted">Le domande inviate sono in attesa e non sono visibili agli altri finché non le approvi.</p>
          {audienceQuestions.length === 0 && <p>Nessuna domanda dal pubblico.</p>}
          {audienceQuestions.filter(aq => aq.status !== 'rejected').map(aq => <div className="qa-row" key={aq.id}><div><p>{aq.body}</p><small>{aq.status} · {voteCounts[aq.id] || 0} voti · {new Date(aq.created_at).toLocaleString()}</small></div><div className="toolbar compact"><Button className="small" onClick={() => moderate(aq, 'approved')}>Approva</Button><Button className="small secondary" onClick={() => moderate(aq, 'pending')}>In attesa</Button><Button className="small danger" onClick={() => moderate(aq, 'rejected')}>Rifiuta</Button><Button className="small danger" onClick={() => moderate(aq, 'delete')}>Elimina</Button></div></div>)}
        </section>
      </>}
      <Notice>{notice}</Notice>
    </>}
    <footer>Prototipo · Prima dell’uso reale, verificare sicurezza, privacy e requisiti ABB.</footer>
  </main>;
}

function ParticipantQuestion({ q, answers, setAnswers, onSubmit, disabled, eventSlug }) {
  useEffect(() => {
    const key = `abb-live-start-${eventSlug}-${q.id}`;
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, String(Date.now()));
  }, [eventSlug, q.id]);
  const done = localStorage.getItem(`abb-live-done-${eventSlug}-${q.id}`) === '1';
  const value = answers[q.id];
  return <section className="card participant-question"><p className="eyebrow">{q.type === 'single' ? 'Scelta singola' : q.type === 'multiple' ? 'Scelta multipla' : q.type === 'rating' ? 'Valutazione' : 'Risposta aperta'}{q.is_required ? ' · obbligatoria' : ''}</p><h2>{q.prompt}</h2>
    {done ? <p className="success-text">Risposta già inviata da questo browser. Grazie.</p> : <>
      {q.type === 'single' && (q.options || []).map(option => <label className="option" key={option}><input type="radio" name={q.id} value={option} checked={value === option} onChange={() => setAnswers(v => ({ ...v, [q.id]: option }))} />{option}</label>)}
      {q.type === 'multiple' && (q.options || []).map(option => { const selected = Array.isArray(value) ? value : []; return <label className="option" key={option}><input type="checkbox" checked={selected.includes(option)} onChange={e => setAnswers(v => ({ ...v, [q.id]: e.target.checked ? [...selected, option] : selected.filter(x => x !== option) }))} />{option}</label>; })}
      {q.type === 'open' && <textarea rows="4" value={value || ''} onChange={e => setAnswers(v => ({ ...v, [q.id]: e.target.value }))} maxLength={2000} placeholder="La tua risposta" />}
      {q.type === 'rating' && <div className="rating-input">{[1,2,3,4,5].map(n => <label key={n}><input type="radio" name={q.id} checked={Number(value) === n} onChange={() => setAnswers(v => ({ ...v, [q.id]: n }))} />{n}</label>)}</div>}
      <Button disabled={disabled} onClick={() => onSubmit(q)}>{disabled ? 'Invio…' : 'Invia risposta'}</Button>
    </>}
  </section>;
}

function AudienceQAParticipant({ event, value, setValue, onSubmit, busy }) {
  const [approved, setApproved] = useState([]);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const [{ data: qs }, { data: counts }] = await Promise.all([
        supabase.from('public_audience_questions').select('*').eq('event_id', event.id).order('created_at', { ascending: true }),
        supabase.from('audience_question_vote_counts').select('*')
      ]);
      if (alive) setApproved((qs || []).map(q => ({ ...q, votes: (counts || []).find(c => c.audience_question_id === q.id)?.vote_count || 0 })));
    };
    refresh(); const timer = setInterval(refresh, 3500);
    return () => { alive = false; clearInterval(timer); };
  }, [event.id]);
  return <section className="card"><p className="eyebrow">Audience Q&amp;A</p><h2>Invia una domanda</h2><form className="stack" onSubmit={onSubmit}><textarea rows="3" maxLength={2000} value={value} onChange={e => setValue(e.target.value)} required placeholder="Scrivi la tua domanda"/><Button disabled={busy}>Invia al moderatore</Button></form><h3>Domande approvate</h3>
    {approved.length === 0 && <p className="muted">Nessuna domanda pubblicata.</p>}
    {approved.map(q => <div className="qa-row" key={q.id}><p>{q.body}</p><Button className="secondary small" onClick={() => { const key = `abb-live-voted-${new URLSearchParams(window.location.search).get('join')}-${q.id}`; if (localStorage.getItem(key)) return; supabase.from('question_votes').insert({ audience_question_id: q.id, respondent_id: respondentId(new URLSearchParams(window.location.search).get('join')) }).then(({ error }) => { if (!error) localStorage.setItem(key, '1'); }); }}>▲ {q.votes}</Button></div>)}
  </section>;
}

function QuestionCard({ q, index, total, rows, onEdit, onToggle, onDelete, onMove }) {
  const counts = useMemo(() => {
    const result = {};
    rows.forEach(r => { const text = answerToText(r.answer); result[text] = (result[text] || 0) + 1; });
    return result;
  }, [rows]);
  return <section className="card result-card"><div className="result-title"><div><p className="eyebrow">{q.type} · {q.is_open ? 'attiva' : 'in pausa'}</p><h3>{q.prompt}</h3></div><span className="answer-count">{rows.length} risposte</span></div>
    {Object.keys(counts).length > 0 ? (
  <div className="result-list">
    {Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([answer, count]) => {
        const percentage = Math.round(
          (count / Math.max(rows.length, 1)) * 100
        );
        const barWidth = Math.max(4, percentage);

        return (
          <div className="result-row" key={answer}>
            <span>{answer}</span>
            <strong>
              {count} ({percentage}%)
            </strong>
            <div className="bar">
              <span style={{ width: `${barWidth}%` }} />
            </div>
          </div>
        );
      })}
  </div>
) : (
  <p className="muted">Ancora nessuna risposta.</p>
)}
    <details><summary>Visualizza risposte individuali</summary>{rows.map(r => <div className="response-row" key={r.id}><span>{answerToText(r.answer)}</span><small>{r.elapsed_seconds ?? 'n/d'} s · {new Date(r.created_at).toLocaleString()}</small></div>)}</details>
    <div className="toolbar compact"><Button className="small secondary" onClick={onMove.bind(null, -1)} disabled={index === 0}>↑ Su</Button><Button className="small secondary" onClick={onMove.bind(null, 1)} disabled={index === total - 1}>↓ Giù</Button><Button className="small secondary" onClick={onEdit}>Modifica</Button><Button className="small secondary" onClick={onToggle}>{q.is_open ? 'Metti in pausa' : 'Riattiva'}</Button><Button className="small danger" onClick={onDelete}>Elimina</Button></div>
  </section>;
}

createRoot(document.getElementById('root')).render(<App />);
