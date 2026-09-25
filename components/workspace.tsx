'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useRef, useState} from 'react';
import Papa from 'papaparse';
import {
  ArrowLeft, ArrowRight, Bell, Bot, BriefcaseBusiness, Check, CheckCheck, ChevronLeft,
  ChevronRight, Clock, Download, FileText, Image as ImageIcon, Info,
  LogOut, Menu, MessageCircle, MessageSquare, MoreVertical, Package,
  Paperclip, Pencil, Plus, Search, Send, Settings, ShieldCheck, Smile, Sparkles, Upload,
  UserRound, Users, X, Zap,
} from 'lucide-react';
import CataloguePanel, {ProductMessage} from './catalogue-panel';
import Dialog from './dialog';
import {catalogueDemoProducts, productSnapshot} from '@/lib/catalogue';
import {canAdmin, canManage, messagingOpen, normalizePhone, templateVariables} from '@/lib/domain';
import {demoAction, demoData} from '@/lib/demo';
import {api, browserDB, configured} from '@/lib/supabase';
import {signOutPhoneSession} from '@/lib/phone-auth';
import type {Action, Contact, Data, Message, Row} from '@/lib/types';

type MainPage = 'Chats' | 'Contacts' | 'Tools' | 'More';
type ToolView = 'home' | 'quick-replies' | 'media';
type MoreView = 'home' | 'ai' | 'connection' | 'profile' | 'settings';

const navigation = [
  ['Chats', MessageSquare], ['Contacts', Users], ['Tools', Zap], ['More', Menu],
] as const;
const time = (value: string) => new Date(value).toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'});
const initials = (value: string) => value.replace(/^Dr\. /, '').split(' ').slice(0, 2).map((part) => part[0]).join('');
const inputValues = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));

export default function Workspace() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [demo, setDemo] = useState(!configured);
  const [page, setPage] = useState<MainPage>('Chats');
  const [toolView, setToolView] = useState<ToolView>('home');
  const [moreView, setMoreView] = useState<MoreView>('home');
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [chatSearch, setChatSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const [contactInfoId, setContactInfoId] = useState('');
  const [dialog, setDialog] = useState<{type: string; row?: Row} | null>(null);
  const [catalogueContext, setCatalogueContext] = useState<'chat' | 'manage' | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<Row | null>(null);
  const [importRows, setImportRows] = useState<Row[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const state = useRef<Data | null>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const catalogueLoaded = useRef(false);

  useEffect(() => {state.current = data;}, [data]);
  const notify = (message: string) => {setToast(message); window.setTimeout(() => setToast(''), 5000);};

  async function loadCatalogue() {
    if (demo || catalogueLoaded.current) return;
    const products: Row[] = [];
    let offset = 0;
    const pageSize = 300;
    for (;;) {
      const result = await api(`/api/catalogue?limit=${pageSize}&offset=${offset}`);
      products.push(...result.products);
      if (!result.has_more) break;
      offset += result.products.length;
    }
    catalogueLoaded.current = true;
    setData((current) => current ? {...current, products} : current);
  }

  async function reload() {
    const next = await api('/api/bootstrap?limit=100') as Data;
    if (catalogueLoaded.current && state.current) next.products = state.current.products;
    setData(next);
    return next;
  }

  useEffect(() => {
    let active = true;
    const local = !configured || new URLSearchParams(location.search).get('demo') === '1';
    setDemo(local);
    if (local) {
      try {
        const saved = localStorage.getItem('open-chet-demo-v1');
        const next = saved ? JSON.parse(saved) : demoData();
        if (Number(next.catalogue_demo_version || 0) < 3) {
          const ids = new Set(next.products.map((product: Row) => product.id));
          next.products.push(...catalogueDemoProducts().filter((product) => !ids.has(product.id)));
          next.products = next.products.map((product: Row) => Number(product.price) === 0 ? {...product, price: null} : product);
          next.catalogue_demo_version = 3;
        }
        if (active) {setData(next); setSelected(next.conversations[0]?.id || '');}
      } catch {
        const next = demoData();
        setData(next);
        setSelected(next.conversations[0]?.id || '');
      }
    } else {
      reload().then((next) => {
        setSelected(next.conversations[0]?.id || '');
        loadCatalogue().catch(() => {});
      }).catch(() => router.push('/login'));
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {active = false;};
  }, []);

  useEffect(() => {if (demo && data) localStorage.setItem('open-chet-demo-v1', JSON.stringify(data));}, [data, demo]);
  useEffect(() => {
    if (!data || demo) return;
    const org = data.organization_id;
    const channel = browserDB().channel(`inbox:${org}`)
      .on('postgres_changes', {event: '*', schema: 'public', table: 'messages', filter: `organization_id=eq.${org}`}, () => reload())
      .on('postgres_changes', {event: '*', schema: 'public', table: 'conversations', filter: `organization_id=eq.${org}`}, () => reload())
      .on('postgres_changes', {event: '*', schema: 'public', table: 'notes', filter: `organization_id=eq.${org}`}, () => reload())
      .on('postgres_changes', {event: '*', schema: 'public', table: 'notifications', filter: `organization_id=eq.${org}`}, () => reload())
      .subscribe();
    const timer = window.setInterval(() => reload().catch(() => {}), 30000);
    return () => {browserDB().removeChannel(channel); window.clearInterval(timer);};
  }, [data?.organization_id, demo]);
  useEffect(() => {messageEnd.current?.scrollIntoView({behavior: 'smooth'});}, [selected, data?.messages.length]);

  useEffect(() => {
    const w = window as any;
    w.openChetNativeBack = () => {
      if (dialog) { setDialog(null); return true; }
      if (catalogueContext) { setCatalogueContext(null); return true; }
      if (contactInfoId) { setContactInfoId(''); return true; }
      if (showNotifications) { setShowNotifications(false); return true; }
      if (showChatMenu) { setShowChatMenu(false); return true; }
      if (showSearch) { setShowSearch(false); setChatSearch(''); return true; }
      if (mobileChat) { setMobileChat(false); return true; }
      if (page === 'Tools' && toolView !== 'home') { setToolView('home'); return true; }
      if (page === 'More' && moreView !== 'home') { setMoreView('home'); return true; }
      if (page !== 'Chats') { setPage('Chats'); setQuery(''); return true; }
      return false;
    };
    return () => { delete w.openChetNativeBack; };
  }, [dialog, catalogueContext, contactInfoId, showNotifications, showChatMenu, showSearch, mobileChat, page, toolView, moreView]);

  async function act(action: Action, success?: string) {
    setBusy(true);
    try {
      let next: Data;
      if (demo) {
        next = demoAction(state.current!, action);
        state.current = next;
        setData(next);
      } else {
        await api('/api/action', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(action)});
        next = await reload();
      }
      if (success) notify(success);
      return next;
    } catch (error) {
      notify((error as Error).message);
      return null;
    } finally {setBusy(false);}
  }

  async function connectionAction(values: Record<string, unknown>, success: string) {
    if (demo) return null;
    setBusy(true);
    try {
      await api('/api/whatsapp-accounts', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(values)});
      const next = await reload();
      notify(success);
      return next;
    } catch (error) {
      notify((error as Error).message);
      return null;
    } finally {setBusy(false);}
  }

  async function checkWhatsAppHealth(account: Row) {
    if (demo) return;
    setBusy(true);
    try {
      const health = await api(`/api/whatsapp-accounts/health?id=${encodeURIComponent(account.id)}`);
      setDialog({type: 'whatsapp-health', row: {...account, health}});
    } catch (error) {
      notify((error as Error).message);
    } finally {setBusy(false);}
  }

  async function openConversation(id: string) {
    setSelected(id);
    setMobileChat(true);
    setDraft('');
    setAttachment(null);
    setShowChatMenu(false);
    await act({type: 'read', id});
    if (!demo) {
      try {
        const result = await api(`/api/bootstrap?conversation=${id}`);
        setData((current) => current ? {...current, messages: [...current.messages.filter((message) => message.conversation_id !== id), ...result.messages]} : current);
      } catch (error) {notify((error as Error).message);}
    }
  }

  async function openContact(contact: Contact) {
    const next = await act({type: 'open', id: contact.id});
    if (!next) return;
    setPage('Chats');
    const conversation = next.conversations.find((item) => item.contact_id === contact.id);
    if (conversation) openConversation(conversation.id);
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if ((!draft.trim() && !attachment) || !selected || sending) return;

    const conversationId = selected;
    const outgoingBody = draft.trim() || attachment?.name || '';
    const outgoingKind = attachment?.kind || 'text';
    const outgoingAttachment = attachment;
    const idempotencyKey = crypto.randomUUID();
    const optimisticId = `optimistic-${idempotencyKey}`;
    const createdAt = new Date().toISOString();

    setDraft('');
    setAttachment(null);
    setSending(true);

    setData((current) => current ? {
      ...current,
      messages: [...current.messages, {
        id: optimisticId,
        conversation_id: conversationId,
        direction: 'out',
        kind: outgoingKind,
        body: outgoingBody,
        status: 'sending',
        created_at: createdAt,
        sender_name: 'You',
        media_id: outgoingAttachment?.media_id,
        media_url: outgoingAttachment?.media_url,
      }],
      conversations: current.conversations.map((item) => item.id === conversationId ? {...item, preview: outgoingBody, updated_at: createdAt} : item),
    } : current);

    try {
      await api('/api/action', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          type: 'send',
          id: conversationId,
          values: {
            body: outgoingBody,
            kind: outgoingKind,
            media_id: outgoingAttachment?.media_id,
            media_url: outgoingAttachment?.media_url,
            idempotency_key: idempotencyKey,
          },
        }),
      });
      await reload();
    } catch (error) {
      setData((current) => current ? {
        ...current,
        messages: current.messages.map((message) => message.id === optimisticId ? {...message, status: 'failed'} : message),
      } : current);
      setDraft((current) => current || outgoingBody);
      if (outgoingAttachment) setAttachment((current) => current || outgoingAttachment);
      notify((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function upload(file: File) {
    if (file.size > 16 * 1024 * 1024) {notify('Maximum attachment size is 16 MB'); return;}
    setBusy(true);
    try {
      if (demo) {
        const kind = file.type.startsWith('image') ? 'image' : file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'document';
        setAttachment({id: crypto.randomUUID(), name: file.name, kind, media_url: URL.createObjectURL(file)});
      } else {
        const form = new FormData(); form.set('file', file); form.set('conversation_id', selected);
        setAttachment({id: crypto.randomUUID(), ...await api('/api/media', {method: 'POST', body: form})});
      }
    } catch (error) {notify((error as Error).message);} finally {setBusy(false);}
  }

  async function downloadMedia(message: Message) {
    if (demo) {notify('Demo media is only available in its original browser session'); return;}
    try {
      const {data: {session}} = await browserDB().auth.getSession();
      const response = await fetch(`/api/media?message=${message.id}`, {headers: {Authorization: `Bearer ${session?.access_token}`}});
      if (!response.ok) throw Error('Media could not be downloaded');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = message.body || 'attachment'; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {notify((error as Error).message);}
  }

  function navigate(name: MainPage) {
    setPage(name); setQuery(''); setMobileChat(false); setShowChatMenu(false);
    if (name === 'Tools') setToolView('home');
    if (name === 'More') setMoreView('home');
  }

  async function openCatalogue(context: 'chat' | 'manage') {
    if (!demo) await loadCatalogue().catch((error) => notify((error as Error).message));
    setCatalogueContext(context);
  }

  async function saveForm(event: React.FormEvent<HTMLFormElement>, type: string, id?: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const values: any = inputValues(form);
    if (type === 'contact') {
      values.tags = String(values.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
      values.opted_in = values.opted_in === 'on';
      try {values.custom_fields = JSON.parse(String(values.custom_fields || '{}'));} catch {notify('Custom fields must be a JSON object'); return;}
    }
    if (type === 'product') {
      values.featured = values.featured === 'on';
      values.price = values.price === '' ? null : Number(values.price);
    }
    const next = await act({type, id, values}, 'Saved');
    if (next) {
      setDialog(null);
      if (type === 'product') {catalogueLoaded.current = false; await loadCatalogue().catch(() => {});}
    }
  }

  function field(label: string, name: string, value: unknown = '', type = 'text', required = false) {
    return <label key={name}>{label}<input name={name} defaultValue={String(value ?? '')} type={type} step={type === 'number' ? 'any' : undefined} required={required}/></label>;
  }
  function area(label: string, name: string, value: unknown = '') {
    return <label>{label}<textarea name={name} defaultValue={String(value ?? '')} rows={3}/></label>;
  }
  function selectField(label: string, name: string, options: string[], value: unknown) {
    return <label>{label}<select name={name} defaultValue={String(value ?? options[0])}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
  }

  if (!data) return <div className="loading"><span className="brand-icon"><MessageSquare/></span><h2>Opening Open Chet…</h2><a href="/login">Sign in</a></div>;

  const conversation = data.conversations.find((item) => item.id === selected);
  const contact = data.contacts.find((item) => item.id === conversation?.contact_id);
  const conversationAccount = data.connection?.whatsapp_accounts?.find((account) => account.id === conversation?.whatsapp_account_id);
  const messagingWindowOpen = messagingOpen(conversation?.last_inbound_at || null);
  const manager = canManage(data.role);
  const admin = canAdmin(data.role);
  const visibleConversations = data.conversations.filter((item) => {
    const person = data.contacts.find((candidate) => candidate.id === item.contact_id);
    return [person?.name, person?.phone, person?.company, item.preview].join(' ').toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const messages = data.messages.filter((message) => message.conversation_id === selected && message.body.toLowerCase().includes(chatSearch.toLowerCase()));
  const quickReplies = data.quick_replies.filter((reply) => `${reply.shortcut} ${reply.body}`.toLowerCase().includes(query.toLowerCase()));
  const infoContact = data.contacts.find((item) => item.id === contactInfoId);
  const infoConversation = data.conversations.find((item) => item.contact_id === contactInfoId);
  const infoNotes = data.notes.filter((note) => note.conversation_id === infoConversation?.id);
  const mediaMessages = data.messages.filter((message) => ['image', 'document', 'video', 'audio'].includes(message.kind));

  const contactInfo = infoContact ? <div className="contact-info-overlay" onClick={() => setContactInfoId('')}>
    <aside className="contact-info-sheet" aria-label="Contact Info" onClick={(event) => event.stopPropagation()}>
      <header><button className="icon-button" aria-label="Close contact info" onClick={() => setContactInfoId('')}><X/></button><strong>Contact Info</strong><button className="icon-button" aria-label="Edit contact" onClick={() => setDialog({type: 'contact', row: infoContact})}><Pencil size={18}/></button></header>
      <div className="contact-info-hero"><span className="avatar large">{initials(infoContact.name || infoContact.phone)}</span><h2>{infoContact.name || infoContact.phone}</h2><p>{infoContact.phone}</p>{infoContact.company ? <small>{infoContact.company}</small> : null}<button className="primary" onClick={() => {setContactInfoId(''); openContact(infoContact);}}><MessageCircle size={17}/>Message</button></div>
      <section><button className="info-row" onClick={() => {setContactInfoId(''); setPage('Tools'); setToolView('media');}}><ImageIcon/><span><b>Media, Links & Documents</b><small>Shared files and attachments</small></span><ChevronRight/></button></section>
      <section><h3>Tags</h3><div className="tags">{infoContact.tags.length ? infoContact.tags.map((tag) => <span key={tag}>{tag}</span>) : <small>No tags</small>}</div></section>
      <section><h3>Notes</h3>{infoNotes.length ? infoNotes.map((note) => <p className="note-card" key={note.id}>{note.body}</p>) : <p className="muted">No notes yet.</p>}</section>
      <section><h3>Business details</h3><div className="detail-line"><span>Company</span><b>{infoContact.company || '—'}</b></div><div className="detail-line"><span>Category</span><b>{infoContact.category || '—'}</b></div><div className="detail-line"><span>Phone</span><b>{infoContact.phone}</b></div></section>
    </aside>
  </div> : null;

  return <div className={`app mvp-app ${mobileChat ? 'mobile-chat' : ''}`}>
    <aside className="sidebar mvp-sidebar">
      <Link href="/" className="brand"><span className="brand-icon"><MessageSquare size={23}/></span><span>Open <b>Chet</b></span></Link>
      <nav>{navigation.map(([name, Icon]) => <button key={name} className={page === name ? 'nav-item active' : 'nav-item'} onClick={() => navigate(name)}><Icon size={20}/><span>{name}</span>{name === 'Chats' && data.conversations.some((item) => item.unread) ? <b>{data.conversations.filter((item) => item.unread).length}</b> : null}</button>)}</nav>
      <div className="sidebar-bottom"><button className="profile" onClick={() => navigate('More')}><span className="avatar small">{initials(data.members.find((member) => member.id === data.user_id)?.name || 'You')}</span><span><strong>{data.members.find((member) => member.id === data.user_id)?.name || 'You'}</strong><small>{data.role}</small></span><Settings size={17}/></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar mvp-topbar"><div className="mobile-brand">Open Chet</div><div className="breadcrumb"><strong>{page}</strong></div><div className="topbar-right"><span className={`connection ${demo ? 'demo' : ''}`}><span/>{demo ? 'Demo workspace' : data.connection?.whatsapp ? 'WhatsApp connected' : 'Setup needed'}</span><button className="icon-button" aria-label="Notifications" onClick={() => setShowNotifications((value) => !value)}><Bell size={20}/></button></div></header>
      {demo ? <div className="demo-banner"><span><ShieldCheck size={14}/>Demo data · Messages stay on this device.</span><a href="/login">Connect your business <ArrowRight size={13}/></a></div> : null}
      {showNotifications ? <div className="notifications"><h3>Notifications</h3>{data.notifications.length ? data.notifications.slice(0, 10).map((notification) => <p key={notification.id}>{notification.body}</p>) : <p>You’re all caught up.</p>}<button className="link" onClick={() => act({type: 'notify_read'})}>Mark all as read</button></div> : null}

      {page === 'Chats' ? <main className="inbox mvp-inbox">
        <section className="chat-list">
          <div className="mobile-chats-heading"><strong>Chats</strong><button className="icon-button" aria-label="New conversation" onClick={() => setDialog({type: 'new-chat'})}><Plus/></button></div>
          <div className="search chat-list-search"><Search size={18}/><input placeholder="Search chats…" aria-label="Search chats" value={query} onChange={(event) => setQuery(event.target.value)}/></div>
          <div className="conversation-scroll">{visibleConversations.map((item) => {
            const person = data.contacts.find((candidate) => candidate.id === item.contact_id);
            const account = data.connection?.whatsapp_accounts?.find((candidate) => candidate.id === item.whatsapp_account_id);
            const displayName = person?.name || person?.phone || 'Unknown contact';
            return <button key={item.id} className={`conversation ${selected === item.id ? 'selected' : ''}`} onClick={() => openConversation(item.id)} aria-label={`${displayName} ${item.preview}`}>
              <span className={`avatar color-${data.contacts.findIndex((candidate) => candidate.id === item.contact_id) % 4}`}>{initials(displayName)}</span>
              <div className="conversation-copy"><div className="conversation-title"><strong>{displayName}</strong><time>{time(item.updated_at)}</time></div><div className="conversation-preview"><p>{item.preview || 'Start a conversation'}{account ? <small>{` · ${account.display_phone_number || account.label}`}</small> : null}</p>{item.unread > 0 ? <b className="unread">{item.unread}</b> : null}</div></div>
            </button>;
          })}{!visibleConversations.length ? <div className="empty"><Search/><h3>No chats found</h3></div> : null}</div>
        </section>
        {conversation && contact ? <section className="chat-panel">
          <header className="chat-header">
            <button className="icon-button mobile-back" aria-label="Back to chats" onClick={() => setMobileChat(false)}><ArrowLeft/></button>
            <span className="avatar">{initials(contact.name || contact.phone)}</span>
            <button className="contact-heading" onClick={() => setContactInfoId(contact.id)}><strong>{contact.name || contact.phone}</strong><small>{contact.company || contact.phone}{conversationAccount ? ` · via ${conversationAccount.display_phone_number || conversationAccount.label}` : ''}</small></button>
            <button className="icon-button" aria-label="Search in conversation" onClick={() => setShowSearch((value) => !value)}><Search size={19}/></button>
            <div className="chat-menu-wrap"><button className="icon-button" aria-label="More conversation actions" aria-expanded={showChatMenu} onClick={() => setShowChatMenu((value) => !value)}><MoreVertical size={20}/></button>
              {showChatMenu ? <div className="chat-menu" role="menu">
                <button onClick={() => {setContactInfoId(contact.id); setShowChatMenu(false);}}><Info/>Contact Info</button>
                <button onClick={() => {setShowSearch(true); setShowChatMenu(false);}}><Search/>Search</button>
                <button onClick={() => {setPage('Tools'); setToolView('media'); setMobileChat(false); setShowChatMenu(false);}}><ImageIcon/>Media / Documents</button>
                <button onClick={() => {openCatalogue('chat'); setShowChatMenu(false);}}><Package/>Catalogue</button>
                <button disabled={busy} onClick={() => {act({type: 'mode', id: selected, values: {mode: conversation.mode === 'ai' ? 'human' : 'ai'}}); setShowChatMenu(false);}}>{conversation.mode === 'ai' ? <UserRound/> : <Bot/>}{conversation.mode === 'ai' ? 'Take Over' : 'Resume AI'}</button>
                <button className="danger" onClick={() => {setDialog({type: 'clear-chat'}); setShowChatMenu(false);}}><X/>Clear Chat</button>
              </div> : null}
            </div>
          </header>
          {showSearch ? <div className="search chat-search"><Search size={16}/><input aria-label="Find in chat" placeholder="Find a message" value={chatSearch} onChange={(event) => setChatSearch(event.target.value)}/><button className="icon-button" onClick={() => {setShowSearch(false); setChatSearch('');}}><X/></button></div> : null}
          <div className="messages">
            {!demo && messages.length >= 50 ? <button className="secondary load-more" onClick={async () => {const result = await api(`/api/bootstrap?conversation=${selected}&before=${encodeURIComponent(messages[0].created_at)}`); setData((current) => current ? {...current, messages: [...result.messages, ...current.messages]} : current);}}>Load older messages</button> : null}
            <div className="chat-security"><ShieldCheck size={13}/>{demo ? 'Demo conversation' : 'Messages are saved securely'}</div>
            {messages.map((message, index) => <div key={message.id}>
              {(index === 0 || new Date(messages[index - 1].created_at).toDateString() !== new Date(message.created_at).toDateString()) ? <div className="date-divider">{new Date(message.created_at).toLocaleDateString('en-IN', {day: 'numeric', month: 'long'})}</div> : null}
              <div className={`message-row ${message.direction}`}><div className={`message-bubble ${message.direction}`}>
                {message.kind === 'image' && message.media_url?.startsWith('blob:') ? <img className="message-image" src={message.media_url} alt={message.body || 'Attachment'}/> : null}
                {message.kind === 'video' && message.media_url?.startsWith('blob:') ? <video controls src={message.media_url}/> : null}
                {message.kind === 'audio' && message.media_url?.startsWith('blob:') ? <audio controls src={message.media_url}/> : null}
                {['image', 'document', 'video', 'audio'].includes(message.kind) && !message.media_url ? <button className="attachment-link" onClick={() => downloadMedia(message)}><Download size={18}/>Open {message.kind}</button> : null}
                {message.kind === 'template' ? <span className="template-label"><FileText size={12}/>Template message</span> : null}
                {message.kind === 'catalogue' && Array.isArray(message.payload?.products) && message.payload.products.length
                  ? <div className="catalogue-message"><p>{message.body || '🛍️ Product catalogue'}</p><div className="catalogue-message-grid">{message.payload.products.map((product: Row) => <ProductMessage key={String(product.id)} product={productSnapshot(product)}/>)}</div></div>
                  : message.kind === 'product' && message.product_snapshot ? <ProductMessage product={message.product_snapshot}/> : <p>{message.body}</p>}
                <div className="message-meta"><time>{time(message.created_at)}</time>{message.direction === 'out' ? message.status === 'failed' ? <span title={message.meta_error_code ? `Meta error ${message.meta_error_code}` : 'WhatsApp delivery failed'}>failed{message.meta_error_code ? ` · Meta ${message.meta_error_code}` : ''}</span> : message.status === 'read' ? <CheckCheck size={15} className="read"/> : message.status === 'delivered' ? <CheckCheck size={15}/> : message.status === 'sent' ? <Check size={15}/> : message.status === 'demo' ? <span>Demo</span> : <span>{message.status}</span> : null}</div>
              </div></div>
            </div>)}<div ref={messageEnd}/>
          </div>
          <div className="composer-wrap compact-composer-wrap">
            {!messagingWindowOpen ? <div className="window-state"><span className="warning"><Clock size={12}/>24-hour window closed · approved template required</span></div> : null}
            {attachment ? <div className="attachment-preview"><Paperclip size={15}/>{attachment.name}<button className="icon-button" aria-label="Remove attachment" onClick={() => setAttachment(null)}><X size={15}/></button></div> : null}
            {draft.startsWith('/') ? <div className="quick-suggestions">{data.quick_replies.filter((reply) => reply.shortcut.startsWith(draft)).map((reply) => <button key={reply.id} onClick={() => setDraft(reply.body)}><b>{reply.shortcut}</b>{reply.body}</button>)}</div> : null}
            <form className="composer" onSubmit={send}>
              <button type="button" className="icon-button" aria-label="Add emoji" onClick={() => setDraft((value) => `${value} 😊`)}><Smile size={21}/></button>
              <button type="button" className="icon-button" aria-label="Attach file" disabled={!messagingWindowOpen} onClick={() => fileInput.current?.click()}><Paperclip size={21}/></button>
              <input type="file" hidden ref={fileInput} accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,audio/mpeg,audio/ogg,audio/mp4" onChange={(event) => {if (event.target.files?.[0]) upload(event.target.files[0]); event.target.value = '';}}/>
              <input aria-label="Message" placeholder={messagingWindowOpen ? 'Type a message…' : 'Choose an approved template'} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!messagingWindowOpen}/>
              {!messagingWindowOpen ? <button type="button" className="icon-button" aria-label="Choose approved template" onClick={() => setDialog({type: 'send-template'})}><FileText size={20}/></button> : null}
              <button type="button" className="icon-button catalogue-icon" aria-label="Open catalogue" onClick={() => openCatalogue('chat')}><Package size={20}/></button>
              <button className="send-button" aria-label="Send message" disabled={busy || sending || (!draft.trim() && !attachment) || !messagingWindowOpen}><Send size={20}/></button>
            </form>
          </div>
        </section> : <section className="empty inbox-empty"><MessageSquare size={42}/><h2>Select a chat</h2><p>Choose a conversation to view messages.</p></section>}
      </main> : null}

      {page === 'Contacts' ? <main className="page-content mvp-page"><div className="simple-page-header"><div><h1>Contacts</h1><p>{data.contacts.length} contacts</p></div><button className="primary" onClick={() => setDialog({type: 'contact'})}><Plus/>Add</button></div><div className="search page-search"><Search/><input aria-label="Search contacts" placeholder="Search contacts…" value={query} onChange={(event) => setQuery(event.target.value)}/></div><div className="contacts-list">{data.contacts.filter((item) => [item.name, item.phone, item.company].join(' ').toLowerCase().includes(query.toLowerCase())).map((item) => <button className="contact-list-item" key={item.id} onClick={() => setContactInfoId(item.id)}><span className="avatar">{initials(item.name || item.phone)}</span><span><b>{item.name || item.phone}</b><small>{item.phone}{item.company ? ` · ${item.company}` : ''}</small></span><ChevronRight/></button>)}</div></main> : null}

      {page === 'Tools' ? <main className="page-content mvp-page">
        {toolView === 'home' ? <><div className="simple-page-header"><div><h1>Tools</h1><p>Everyday conversation tools</p></div></div><div className="tools-grid">
          <button onClick={() => openCatalogue('manage')}><span><Package/></span><b>Catalogue</b><small>Browse and manage products</small></button>
          <button onClick={() => setToolView('quick-replies')}><span><Zap/></span><b>Quick Replies</b><small>Saved answers for chat</small></button>
          <button onClick={() => setDialog({type: 'import'})}><span><Upload/></span><b>Import Contacts</b><small>Add contacts from CSV</small></button>
          <button onClick={() => setToolView('media')}><span><ImageIcon/></span><b>Media / Documents</b><small>Shared files and links</small></button>
        </div></> : null}
        {toolView === 'quick-replies' ? <><div className="subpage-header"><button className="icon-button" onClick={() => setToolView('home')}><ChevronLeft/></button><div><h1>Quick Replies</h1><p>Type / in chat to use one</p></div><button className="primary" onClick={() => setDialog({type: 'quick_reply'})}><Plus/>Add</button></div><div className="quick-reply-list">{quickReplies.map((reply) => <article key={reply.id}><div><b>{reply.shortcut}</b><p>{reply.body}</p></div><button className="icon-button" aria-label={`Edit ${reply.shortcut}`} onClick={() => setDialog({type: 'quick_reply', row: reply})}><Pencil/></button></article>)}</div></> : null}
        {toolView === 'media' ? <><div className="subpage-header"><button className="icon-button" onClick={() => setToolView('home')}><ChevronLeft/></button><div><h1>Media / Documents</h1><p>Files shared in conversations</p></div></div>{mediaMessages.length ? <div className="media-list">{mediaMessages.map((message) => <button key={message.id} onClick={() => downloadMedia(message)}><FileText/><span><b>{message.body || message.kind}</b><small>{message.kind} · {new Date(message.created_at).toLocaleDateString('en-IN')}</small></span><Download/></button>)}</div> : <div className="empty big"><ImageIcon/><h2>No media yet</h2><p>Images and documents from chats will appear here.</p></div>}</> : null}
      </main> : null}

      {page === 'More' ? <main className="page-content mvp-page">
        {moreView === 'home' ? <><div className="simple-page-header"><div><h1>More</h1><p>Business and assistant settings</p></div></div><div className="more-list">
          <button onClick={() => setMoreView('ai')}><Sparkles/><span><b>AI Settings</b><small>Instructions, tone and escalation</small></span><ChevronRight/></button>
          <button onClick={() => setMoreView('connection')}><MessageSquare/><span><b>WhatsApp Connection</b><small>{data.connection?.whatsapp ? 'Connected' : 'Setup needed'}</small></span><ChevronRight/></button>
          <button onClick={() => setMoreView('profile')}><BriefcaseBusiness/><span><b>Business Profile</b><small>{data.settings.name}</small></span><ChevronRight/></button>
          <button onClick={() => setMoreView('settings')}><Settings/><span><b>Basic Settings</b><small>Hours, timezone and account</small></span><ChevronRight/></button>
        </div></> : null}
        {moreView !== 'home' ? <div className="subpage-header"><button className="icon-button" onClick={() => setMoreView('home')}><ChevronLeft/></button><div><h1>{{ai: 'AI Settings', connection: 'WhatsApp Connection', profile: 'Business Profile', settings: 'Basic Settings'}[moreView]}</h1></div></div> : null}
        {moreView === 'ai' ? <form className="settings-form card" onSubmit={async (event) => {event.preventDefault(); const values = inputValues(event.currentTarget); await act({type: 'settings', values: {...data.settings, ai_enabled: values.ai_enabled === 'on', auto_pause: true, tone: values.tone, instructions: values.instructions, blocked_topics: values.blocked_topics}}, 'AI settings saved');}}><fieldset disabled={!admin || busy}><label className="checkbox-row"><input type="checkbox" name="ai_enabled" defaultChecked={data.settings.ai_enabled}/>Enable AI replies globally</label><label className="checkbox-row locked-setting"><input type="checkbox" checked readOnly/>Pause AI after every manual reply</label>{selectField('Tone', 'tone', ['Professional', 'Friendly', 'Concise'], data.settings.tone)}{area('Business instructions / knowledge', 'instructions', data.settings.instructions)}{area('Escalation guidance', 'blocked_topics', data.settings.blocked_topics)}<button className="primary">Save AI settings</button></fieldset></form> : null}
        {moreView === 'connection' ? <div className="connection-manager"><div className="connection-manager-head"><div><h2>{data.connection?.whatsapp ? 'Connected numbers' : 'Connect WhatsApp Business'}</h2><p>Each conversation replies through the number that received it.</p></div>{admin && !demo ? <button className="primary" onClick={() => setDialog({type: 'whatsapp-account'})}><Plus/>Add WhatsApp number</button> : null}</div>{data.connection?.whatsapp_accounts?.length ? <div className="connection-list">{data.connection.whatsapp_accounts.map((account) => <article className="connection-row" key={account.id}><span className="connection-row-icon"><MessageSquare size={20}/></span><div className="connection-row-copy"><div className="connection-row-title"><b>{account.label}</b><span className={`connection-badge ${account.is_active ? '' : 'disabled'}`}>{account.is_active ? 'Connected' : 'Disabled'}</span>{account.is_default ? <span className="connection-badge default">Default</span> : null}</div><small>{account.display_phone_number || `Phone Number ID ${account.phone_number_id}`}{account.verified_name ? ` · ${account.verified_name}` : ''}</small></div>{admin ? <div className="connection-row-actions"><button className="secondary" disabled={busy} onClick={() => checkWhatsAppHealth(account)}>Meta health</button><button className="secondary" disabled={busy} onClick={() => setDialog({type: 'whatsapp-token', row: account})}>Update token</button>{account.is_active && !account.is_default ? <button className="secondary" disabled={busy} onClick={() => connectionAction({action: 'default', id: account.id}, 'Default number updated')}>Set default</button> : null}<button className="icon-button" aria-label={`Edit ${account.label}`} onClick={() => setDialog({type: 'whatsapp-label', row: account})}><Pencil size={16}/></button><button className="secondary" disabled={busy} onClick={() => connectionAction({action: 'active', id: account.id, is_active: !account.is_active}, account.is_active ? 'WhatsApp number disabled' : 'WhatsApp number enabled')}>{account.is_active ? 'Disable' : 'Enable'}</button></div> : null}</article>)}</div> : <div className="connection-empty">No WhatsApp number is connected yet.</div>}</div> : null}
        {moreView === 'profile' ? <form className="settings-form card" onSubmit={async (event) => {event.preventDefault(); const values = inputValues(event.currentTarget); await act({type: 'settings', values: {...data.settings, name: values.name}}, 'Business profile saved');}}><fieldset disabled={!admin || busy}>{field('Business name', 'name', data.settings.name, 'text', true)}<button className="primary">Save profile</button></fieldset></form> : null}
        {moreView === 'settings' ? <form className="settings-form card" onSubmit={async (event) => {event.preventDefault(); const values = inputValues(event.currentTarget); await act({type: 'settings', values: {...data.settings, business_hours: values.business_hours, timezone: values.timezone}}, 'Settings saved');}}><fieldset disabled={!admin || busy}>{field('Business hours', 'business_hours', data.settings.business_hours)}{field('Time zone', 'timezone', data.settings.timezone)}<button className="primary">Save settings</button></fieldset><hr/>{demo ? <button type="button" className="secondary" onClick={() => setDialog({type: 'reset'})}>Reset demo data</button> : <button type="button" className="secondary" onClick={async () => {try{await signOutPhoneSession(browserDB());router.replace('/login');}catch{notify('Sign out failed. Please try again.');}}}><LogOut/>Sign out</button>}</form> : null}
      </main> : null}

      <nav className="mobile-nav">{navigation.map(([name, Icon]) => <button key={name} className={page === name ? 'active' : ''} onClick={() => navigate(name)}><Icon size={22}/><span>{name}</span></button>)}</nav>
    </div>

    {toast ? <div className="toast" role="status"><Check size={17}/>{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15}/></button></div> : null}
    {contactInfo}
    {catalogueContext ? <CataloguePanel products={data.products} context={catalogueContext} conversationName={contact?.name || contact?.phone} canSend={catalogueContext === 'chat' && Boolean(selected) && messagingWindowOpen} demo={demo} onClose={() => setCatalogueContext(null)} onSend={async (ids) => {const sent: string[] = []; for (const id of ids) {const result = await act({type: 'send', id: selected, values: {kind: 'product', product_id: id, idempotency_key: crypto.randomUUID()}}); if (!result) break; sent.push(id);} return sent;}} onAdd={manager ? () => {setCatalogueContext(null); setDialog({type: 'product'});} : undefined} onEdit={manager ? (product) => {setCatalogueContext(null); setDialog({type: 'product', row: product});} : undefined}/> : null}

    {dialog ? <Dialog title={{contact: dialog.row ? 'Edit contact' : 'Add contact', 'new-chat': 'Start a conversation', 'send-template': 'Choose an approved template', quick_reply: 'Quick reply', product: 'Product details', import: 'Import contacts', 'clear-chat': 'Clear chat', reset: 'Reset demo workspace', 'whatsapp-account': 'Add WhatsApp number', 'whatsapp-label': 'Edit connection name', 'whatsapp-health': 'Meta health', 'whatsapp-token': 'Update WhatsApp token'}[dialog.type] || dialog.type} onClose={() => setDialog(null)}>
      {dialog.type === 'whatsapp-account' ? <form onSubmit={async (event) => {event.preventDefault(); const values = inputValues(event.currentTarget); const next = await connectionAction({action: 'add', ...values, make_default: values.make_default === 'on'}, 'WhatsApp number connected'); if (next) setDialog(null);}}><p className="credential-note"><b>SCM PHARMACY new number is prefilled.</b><br/>Paste the Meta permanent access token, then tap Verify and connect. The token is verified with Meta, encrypted on the server, and never shown again.</p>{field('Connection name / label', 'label', 'SCM PHARMACY • +91 92034 77793', 'text', true)}{field('Phone Number ID', 'phone_number_id', '1415163475002152', 'text', true)}{field('WhatsApp Business Account ID', 'business_account_id', '1975778520048284', 'text', true)}{field('Access Token', 'access_token', '', 'password', true)}<label className="checkbox-row"><input type="checkbox" name="make_default" defaultChecked/>Make this the default WhatsApp number</label><button className="primary" disabled={busy}>Verify and connect</button></form> : null}
      {dialog.type === 'whatsapp-token' && dialog.row ? <form onSubmit={async (event) => {event.preventDefault(); const values = inputValues(event.currentTarget); const next = await connectionAction({action: 'token', id: dialog.row!.id, access_token: values.access_token}, 'WhatsApp token updated'); if (next) setDialog(null);}}><p className="credential-note"><b>{dialog.row.label}</b><br/>Generate the token from the SCM Pharmacy Meta App (App ID 2302630346983637). Open Chet will verify it against this saved Phone Number ID and WABA before replacing the encrypted token.</p>{field('New permanent access token', 'access_token', '', 'password', true)}<button className="primary" disabled={busy}>Verify and replace token</button></form> : null}
      {dialog.type === 'whatsapp-health' && dialog.row ? <div><p className="credential-note"><b>{dialog.row.label}</b><br/>{dialog.row.display_phone_number || dialog.row.phone_number_id}<br/>This reads Meta directly with the encrypted token stored for this number. The token is never returned to the browser.</p><pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:'55vh',overflow:'auto',fontSize:'12px'}}>{JSON.stringify(dialog.row.health,null,2)}</pre></div> : null}
      {dialog.type === 'whatsapp-label' && dialog.row ? <form onSubmit={async (event) => {event.preventDefault(); const values = inputValues(event.currentTarget); const next = await connectionAction({action: 'label', id: dialog.row!.id, label: values.label}, 'Connection name updated'); if (next) setDialog(null);}}>{field('Connection name / label', 'label', dialog.row.label, 'text', true)}<button className="primary" disabled={busy}>Save name</button></form> : null}
      {dialog.type === 'contact' ? <form onSubmit={(event) => saveForm(event, 'contact', dialog.row?.id)}><div className="form-grid">{field('Name', 'name', dialog.row?.name, 'text', true)}{field('Phone (with country code)', 'phone', dialog.row?.phone || '+91', 'tel', true)}{field('Company / clinic', 'company', dialog.row?.company)}{field('Category', 'category', dialog.row?.category)}</div>{field('Tags (comma separated)', 'tags', dialog.row?.tags?.join(', '))}{area('Custom fields (JSON)', 'custom_fields', JSON.stringify(dialog.row?.custom_fields || {}))}<label className="checkbox-row"><input type="checkbox" name="opted_in" defaultChecked={dialog.row?.opted_in}/>Marketing consent recorded</label><button className="primary" disabled={busy}>Save contact</button></form> : null}
      {dialog.type === 'new-chat' ? <div className="picker-list">{data.contacts.map((item) => <button key={item.id} onClick={() => {setDialog(null); openContact(item);}}><span className="avatar small">{initials(item.name || item.phone)}</span><span><b>{item.name || item.phone}</b><small>{item.phone}</small></span><ChevronRight/></button>)}<button className="secondary" onClick={() => setDialog({type: 'contact'})}><Plus/>Add contact</button></div> : null}
      {dialog.type === 'quick_reply' ? <form onSubmit={(event) => saveForm(event, 'quick_reply', dialog.row?.id)}>{field('Shortcut', 'shortcut', dialog.row?.shortcut || '/', 'text', true)}{area('Reply text', 'body', dialog.row?.body)}<button className="primary" disabled={busy}>Save reply</button></form> : null}
      {dialog.type === 'product' ? <form onSubmit={(event) => saveForm(event, 'product', dialog.row?.id)}>{field('Product name', 'name', dialog.row?.name, 'text', true)}{area('Description', 'description', dialog.row?.description)}<div className="form-grid">{field('Category', 'category', dialog.row?.category)}{field('Price (optional)', 'price', dialog.row?.price ?? '', 'number')}{field('Currency', 'currency', dialog.row?.currency || 'INR')}{field('Stock', 'stock', dialog.row?.stock ?? 0, 'number')}{field('Image URL (optional)', 'image_url', dialog.row?.image_url, 'url')}{field('Meta catalogue ID', 'catalogue_id', dialog.row?.catalogue_id)}{field('Retailer product ID', 'retailer_id', dialog.row?.retailer_id)}{field('Brand', 'brand', dialog.row?.brand)}{field('Composition', 'composition', dialog.row?.composition)}{field('Strength', 'strength', dialog.row?.strength)}{field('Form type', 'form_type', dialog.row?.form_type)}{field('Pack size', 'pack_size', dialog.row?.pack_size)}{selectField('Availability', 'availability', ['in_stock', 'out_of_stock', 'on_request'], dialog.row?.availability)}</div>{area('Notes', 'notes', dialog.row?.notes)}<label className="checkbox-row"><input type="checkbox" name="featured" defaultChecked={dialog.row?.featured}/>Featured product</label><button className="primary" disabled={busy}>Save product</button></form> : null}
      {dialog.type === 'send-template' ? <div className="picker-list">{data.templates.filter((template) => demo || template.status === 'APPROVED').map((template) => <button key={template.id} onClick={() => setDialog({type: 'send-template-form', row: template})}><FileText/><span><b>{template.name}</b><small>{template.body}</small></span><ChevronRight/></button>)}{!data.templates.length ? <p>No approved templates are available.</p> : null}</div> : null}
      {dialog.type === 'send-template-form' && dialog.row ? <form onSubmit={async (event) => {event.preventDefault(); const form = new FormData(event.currentTarget); const result = await act({type: 'send', id: selected, values: {kind: 'template', template_id: dialog.row!.id, variables: templateVariables(dialog.row!.body).map((index) => String(form.get(`var${index}`))), idempotency_key: crypto.randomUUID()}}, demo ? 'Template simulated' : 'Template queued'); if (result) setDialog(null);}}><div className="template-preview"><p>{dialog.row.body}</p></div>{templateVariables(dialog.row.body).map((index) => field(`Variable ${index}`, `var${index}`, index === 1 ? contact?.name : '', 'text', true))}<button className="primary" disabled={busy}>Send template</button></form> : null}
      {dialog.type === 'import' ? <><p>CSV columns: name, phone, company, category, tags, notes, custom_fields. Phone numbers must include a country code.</p><label>Select CSV<input type="file" accept=".csv,text/csv" onChange={async (event) => {const file = event.target.files?.[0]; if (!file) return; const parsed = Papa.parse<Record<string, string>>(await file.text(), {header: true, skipEmptyLines: true}); const seen = new Set(data.contacts.map((item) => item.phone)); setImportRows(parsed.data.slice(0, 1000).map((row, index) => {let error = parsed.errors.length ? 'CSV parse error' : ''; let phone = row.phone || ''; try {phone = normalizePhone(phone); if (seen.has(phone)) error = 'Duplicate phone'; seen.add(phone); if (!row.name?.trim()) error = 'Name required'; JSON.parse(row.custom_fields || '{}');} catch {error = 'Invalid phone or custom fields';} return {id: String(index), ...row, phone, error};}));}}/></label><div className="import-preview">{importRows.map((row) => <div key={row.id}><b>{row.name}</b><span>{row.phone}</span><span className={row.error ? 'warning' : 'green-text'}>{row.error || 'Ready'}</span></div>)}</div><p>{importRows.filter((row) => !row.error).length} ready · {importRows.filter((row) => row.error).length} skipped</p><button className="primary" disabled={busy || !importRows.some((row) => !row.error)} onClick={async () => {let count = 0; for (const row of importRows.filter((item) => !item.error)) {const next = await act({type: 'contact', values: {name: row.name, phone: row.phone, company: row.company || '', category: row.category || '', tags: (row.tags || '').split(',').map((tag: string) => tag.trim()).filter(Boolean), custom_fields: JSON.parse(row.custom_fields || '{}'), opted_in: false}}); if (!next) break; count++;} notify(`${count} contacts imported`); setDialog(null);}}>Import valid contacts</button></> : null}
      {dialog.type === 'clear-chat' ? <><p>Clear this conversation history from Open Chet? This cannot be undone.</p><button className="danger-button" disabled={busy} onClick={async () => {const next = await act({type: 'clear_chat', id: selected}, 'Chat cleared'); if (next) setDialog(null);}}>Clear chat</button></> : null}
      {dialog.type === 'reset' ? <><p>Reset local demo messages, contacts and settings?</p><button className="primary" onClick={() => {const next = demoData(); setData(next); setSelected(next.conversations[0].id); setDialog(null); notify('Demo reset');}}>Reset demo</button></> : null}
    </Dialog> : null}
  </div>;
}
