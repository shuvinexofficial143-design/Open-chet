'use client';

import Image from 'next/image';
import {useMemo, useRef, useState} from 'react';
import {ArrowLeft, ChevronLeft, ChevronRight, Filter, Package, Pencil, Plus, Search, Send, X} from 'lucide-react';
import Dialog from './dialog';
import {
  availabilityLabel,
  catalogueGroups,
  formatPrice,
  productSnapshot,
  type Filters,
  type ProductSnapshot,
} from '@/lib/catalogue';
import type {Row} from '@/lib/types';

const emptyFilters: Filters = {query: '', category: '', brand: '', form: '', stock: '', sort: 'name', featured: false};

export function ProductImage({product, large = false}: {product: ProductSnapshot; large?: boolean}) {
  const [failed, setFailed] = useState(false);
  return <div className={`catalogue-image ${large ? 'large' : ''}`}>
    {product.image_url && !failed
      ? <Image src={product.image_url} alt={product.name} fill sizes={large ? '520px' : '180px'} unoptimized onError={() => setFailed(true)}/>
      : <div className="catalogue-image-empty" aria-label="Medicine image placeholder"><Package size={large ? 42 : 25} strokeWidth={1.4}/></div>}
  </div>;
}

export function ProductMessage({product}: {product: ProductSnapshot}) {
  const price = formatPrice(product);
  return <article className="shared-product">
    <ProductImage product={product}/>
    <div>
      <span className={`stock-badge ${product.availability}`}>{availabilityLabel(product.availability)}</span>
      <h3>{product.name}</h3>
      <p>{[product.brand, product.composition, product.strength].filter(Boolean).join(' · ') || product.form_type || product.category}</p>
      {product.pack_size ? <small>{product.pack_size}</small> : null}
      {price ? <strong className="product-price">{price}</strong> : null}
    </div>
  </article>;
}

function chunks<T>(items: T[], size: number) {
  return Array.from({length: Math.ceil(items.length / size)}, (_, index) => items.slice(index * size, index * size + size));
}

function ProductCard({product, onDetails}: {product: Row; onDetails: (product: Row) => void}) {
  const snapshot = productSnapshot(product);
  const price = formatPrice(snapshot);
  return <button className="catalogue-product" type="button" onClick={() => onDetails(product)} aria-label={`Details for ${snapshot.name}`}>
    <ProductImage product={snapshot}/>
    <div className="catalogue-product-copy">
      <span className={`stock-dot ${snapshot.availability}`} aria-label={availabilityLabel(snapshot.availability)}/>
      <h4>{snapshot.name}</h4>
      <p>{[snapshot.strength, snapshot.form_type].filter(Boolean).join(' · ') || snapshot.category}</p>
      {price ? <strong className="product-price">{price}</strong> : null}
      <span className="product-details-link">Details <ChevronRight size={12}/></span>
    </div>
  </button>;
}

function ProductRail({category, products, onDetails}: {category: string; products: Row[]; onDetails: (product: Row) => void}) {
  const rail = useRef<HTMLDivElement>(null);
  const pages = chunks(products, 6);
  const move = (direction: number) => rail.current?.scrollBy({left: direction * rail.current.clientWidth, behavior: 'smooth'});
  return <section className="catalogue-category" aria-label={category}>
    <header>
      <div><h3>{category}</h3><span>{products.length} products</span></div>
      {pages.length > 1 ? <div className="rail-buttons">
        <button type="button" aria-label={`Previous ${category} products`} onClick={() => move(-1)}><ChevronLeft size={18}/></button>
        <button type="button" aria-label={`More ${category} products`} onClick={() => move(1)}><ChevronRight size={18}/></button>
      </div> : null}
    </header>
    <div className="product-rail" ref={rail} tabIndex={0} aria-label={`${category} product pages`}>
      {pages.map((page, index) => <div className="catalogue-page" key={`${category}-${index}`} aria-label={`${category} page ${index + 1}`}>
        {page.map((product) => <ProductCard key={product.id} product={product} onDetails={onDetails}/>)}
      </div>)}
    </div>
    {pages.length > 1 ? <div className="rail-cue" aria-hidden="true">{pages.map((_, index) => <i key={index}/>)}</div> : null}
  </section>;
}

function ProductDetailSheet({
  product, context, canSend, busy, onClose, onSend, onEdit,
}: {
  product: Row;
  context: 'chat' | 'manage';
  canSend: boolean;
  busy: boolean;
  onClose: () => void;
  onSend: () => void;
  onEdit?: (product: Row) => void;
}) {
  const snapshot = productSnapshot(product);
  const price = formatPrice(snapshot);
  const rows = [
    ['Brand', snapshot.brand], ['Composition', snapshot.composition], ['Strength', snapshot.strength],
    ['Category', snapshot.category], ['Form type', snapshot.form_type], ['Pack size', snapshot.pack_size],
    ['Availability', availabilityLabel(snapshot.availability)], ['Price', price],
  ].filter(([, value]) => Boolean(value));
  return <div className="product-sheet-backdrop" onClick={onClose}>
    <section className="product-detail-sheet" role="dialog" aria-modal="true" aria-label="Product details" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle"/>
      <header>
        <button className="icon-button desktop-sheet-back" aria-label="Back to catalogue" onClick={onClose}><ArrowLeft size={19}/></button>
        <strong>Product details</strong>
        <button className="icon-button" aria-label="Close product details" onClick={onClose}><X size={19}/></button>
      </header>
      <div className="product-sheet-scroll">
        <ProductImage product={snapshot} large/>
        <span className={`stock-badge ${snapshot.availability}`}>{availabilityLabel(snapshot.availability)}</span>
        <h2>{snapshot.name}</h2>
        <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {snapshot.notes ? <div className="product-notes"><h4>Notes</h4><p>{snapshot.notes}</p></div> : null}
      </div>
      <footer>
        {context === 'chat'
          ? <button className="primary" disabled={busy || !canSend} onClick={onSend}><Send size={16}/>Send to chat</button>
          : <button className="primary" onClick={() => onEdit?.(product)}><Pencil size={16}/>Edit product</button>}
      </footer>
    </section>
  </div>;
}

type CataloguePanelProps = {
  products: Row[];
  context: 'chat' | 'manage';
  conversationName?: string;
  onClose: () => void;
  onSend?: (ids: string[]) => Promise<string[]>;
  onEdit?: (product: Row) => void;
  onAdd?: () => void;
  canSend?: boolean;
  demo: boolean;
};

export default function CataloguePanel({
  products, context, conversationName, onClose, onSend, onEdit, onAdd, canSend = false, demo,
}: CataloguePanelProps) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [details, setDetails] = useState<Row | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const groups = useMemo(() => catalogueGroups(products, filters), [products, filters]);
  const categories = useMemo(() => [...new Set(products.map((product) => productSnapshot(product).category))], [products]);
  const values = (key: string) => [...new Set(products.map((product) => String(product[key] || '')).filter(Boolean))].sort();
  const update = (key: keyof Filters, value: string | boolean) => setFilters((current) => ({...current, [key]: value}));

  async function send(product: Row) {
    if (!onSend || busy || !canSend) return;
    setBusy(true);
    setStatus('');
    try {
      const sent = await onSend([product.id]);
      if (sent.length) {
        setStatus(`${product.name} ${demo ? 'added to demo chat' : 'queued for sending'}.`);
        setDetails(null);
      }
    } catch {
      setStatus('This product could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={context === 'chat' ? 'Share catalogue' : 'Catalogue'} onClose={() => {if (!busy) onClose();}}>
    <div className="catalogue-experience">
      <div className="catalogue-context">
        <span>{context === 'chat' ? <>Share with <strong>{conversationName}</strong></> : 'Browse and manage products'}</span>
        {context === 'manage' && onAdd ? <button className="secondary compact-action" onClick={onAdd}><Plus size={15}/>Add product</button> : null}
      </div>
      {context === 'chat' && !canSend ? <div className="notice">The 24-hour messaging window is closed. Send an approved template first.</div> : null}
      <div className="catalogue-sticky">
        <div className="catalogue-search">
          <Search size={18}/>
          <input aria-label="Search catalogue" placeholder="Search medicines…" value={filters.query} onChange={(event) => update('query', event.target.value)}/>
          <button className={showFilters ? 'filter-toggle active' : 'filter-toggle'} onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}><Filter size={16}/><span>Filters</span></button>
        </div>
        <div className="category-chips" aria-label="Catalogue categories">
          <button className={!filters.category ? 'active' : ''} onClick={() => update('category', '')}>All</button>
          {categories.map((category) => <button className={filters.category === category ? 'active' : ''} key={category} onClick={() => update('category', category)}>{category}</button>)}
        </div>
        {showFilters ? <div className="advanced-filters">
          <select aria-label="Catalogue brand" value={filters.brand} onChange={(event) => update('brand', event.target.value)}><option value="">All brands</option>{values('brand').map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="Catalogue form" value={filters.form} onChange={(event) => update('form', event.target.value)}><option value="">All forms</option>{values('form_type').map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="Catalogue stock" value={filters.stock} onChange={(event) => update('stock', event.target.value)}><option value="">All availability</option><option value="in_stock">In stock</option><option value="out_of_stock">Out of stock</option><option value="on_request">On request</option></select>
          <select aria-label="Sort catalogue" value={filters.sort} onChange={(event) => update('sort', event.target.value)}><option value="name">Name A–Z</option><option value="newest">Newest</option><option value="availability">Availability</option></select>
        </div> : null}
      </div>
      <div className="catalogue-sections">
        {groups.map((group) => <ProductRail key={group.category} {...group} onDetails={setDetails}/>)}
        {!groups.length ? <div className="empty"><Package size={35}/><h3>{products.length ? 'No matching products' : 'Your catalogue is empty'}</h3><p>{products.length ? 'Try another search or category.' : 'Add a product to get started.'}</p></div> : null}
      </div>
      <div className="catalogue-status" role="status">{status}</div>
      {details ? <ProductDetailSheet product={details} context={context} canSend={canSend} busy={busy} onClose={() => setDetails(null)} onSend={() => send(details)} onEdit={onEdit}/> : null}
    </div>
  </Dialog>;
}
