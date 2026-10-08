'use client';

import {useEffect, useState} from 'react';
import {Download, FileText, Image as ImageIcon, Volume2, X} from 'lucide-react';
import type {Message} from '@/lib/types';

export function isMediaPlaceholder(body: string, kind: string): boolean {
  const value=(body||'').trim().toLowerCase();
  return !value || value===`[${kind.toLowerCase()}]` ||
    (kind==='image' && ['photo','image','[photo]','[image]'].includes(value));
}

type Props = {message: Message; onDownload: () => void};

export default function ChatMedia({message,onDownload}:Props) {
  const [failed,setFailed]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const kind=message.kind;
  const blobUrl=message.media_url?.startsWith('blob:') ? message.media_url : null;
  const serverUrl=message.media_id ? `/api/media?message=${encodeURIComponent(message.id)}&inline=1` : null;
  const src=blobUrl || serverUrl;

  useEffect(() => {
    setFailed(false);
    setExpanded(false);
  }, [message.id]);

  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key==='Escape') setExpanded(false);
    }
    document.addEventListener('keydown',onKeyDown);
    return () => document.removeEventListener('keydown',onKeyDown);
  }, [expanded]);

  if(kind==='image') {
    if(!src || failed) {
      return <div className="chat-photo-unavailable" role="status">
        <ImageIcon size={26}/>
        <strong>{failed ? 'Photo unavailable' : 'Photo not available'}</strong>
        <span>{failed ? 'This WhatsApp photo may have expired. Ask the customer to send it again.' : 'The original image was not included with this message.'}</span>
        {message.media_id ? <button className="photo-retry" onClick={() => {setFailed(false);}}>Retry photo</button> : null}
      </div>;
    }
    return <>
      <button type="button" className="chat-photo-button" aria-label="View customer photo"
        onClick={() => setExpanded(true)}>
        <img src={src} alt="Photo shared in conversation" className="chat-photo" loading="lazy"
          onError={() => setFailed(true)}/>
        <span className="chat-photo-hover"><ImageIcon size={16}/> View photo</span>
      </button>
      {expanded ? <div className="chat-photo-lightbox" role="presentation"
        onClick={() => setExpanded(false)}>
        <div className="chat-photo-lightbox-content" role="dialog" aria-modal="true"
          aria-label="Photo preview" onClick={e => e.stopPropagation()}>
          <div className="chat-photo-lightbox-toolbar">
            <span>Shared photo</span>
            <div>
              <button type="button" aria-label="Download photo"
                onClick={onDownload}><Download size={19}/> <span>Download</span></button>
              <button type="button" aria-label="Close photo preview"
                onClick={() => setExpanded(false)}><X size={22}/></button>
            </div>
          </div>
          <img src={src} alt="Full-size photo shared in conversation"/>
        </div>
      </div> : null}
    </>;
  }

  if(kind==='audio' && src) return <div className="chat-audio">
    <span><Volume2 size={15}/> Voice message</span>
    <audio src={src} controls preload="none" aria-label="Play voice message" onError={() => setFailed(true)}/>
    {failed && <button className="attachment-link" onClick={onDownload}>Download audio</button>}
  </div>;

  if(kind==='video' && src) return <video className="chat-video" src={src} controls preload="metadata" aria-label="Video shared in conversation"/>;

  if(['document','video','audio'].includes(kind))return <button type="button" className="chat-file"
      onClick={onDownload}>
    {kind==='audio' ? <Volume2 size={22}/> : <FileText size={22}/>}
    <span><strong>{kind==='document'?'Document':kind==='video'?'Video':'Voice message'}</strong>
    <small>Tap to download</small></span><Download size={18}/>
  </button>;

  return null;
}
