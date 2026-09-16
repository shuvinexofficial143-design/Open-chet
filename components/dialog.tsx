'use client';
import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';
export default function Dialog({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const el=ref.current;el?.showModal();return()=>el?.close()},[]);return <dialog ref={ref} onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose()}}><div className="dialog-title"><h2>{title}</h2><button aria-label="Close dialog" className="icon-button" onClick={onClose}><X/></button></div>{children}</dialog>}
