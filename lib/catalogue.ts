import type {Row} from './types';

export type ProductSnapshot = {
  id: string;
  name: string;
  category: string;
  brand: string;
  composition: string;
  strength: string;
  form_type: string;
  pack_size: string;
  availability: string;
  image_url: string;
  notes: string;
  price: number | null;
  currency: string;
};

export const categoryOrder = ['Injection', 'Tablet', 'Ointment', 'Surgical', 'General / Consumables'];

export function meaningfulPrice(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function formatPrice(product: Pick<ProductSnapshot, 'price' | 'currency'>) {
  const price = meaningfulPrice(product.price);
  if (price === null) return '';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: product.currency || 'INR', maximumFractionDigits: 2,
  }).format(price);
}

export function productSnapshot(product: Row): ProductSnapshot {
  const stock = Number(product.stock);
  const availability = product.availability === 'on_request'
    ? 'on_request'
    : stock <= 0 || product.availability === 'out_of_stock' ? 'out_of_stock' : 'in_stock';
  return {
    id: product.id,
    name: String(product.name || ''),
    category: String(product.category || 'General / Consumables'),
    brand: String(product.brand || ''),
    composition: String(product.composition || ''),
    strength: String(product.strength || ''),
    form_type: String(product.form_type || ''),
    pack_size: String(product.pack_size || ''),
    availability,
    image_url: typeof product.image_url === 'string' && product.image_url.startsWith('https://') ? product.image_url : '',
    notes: String(product.notes || product.description || ''),
    price: meaningfulPrice(product.price),
    currency: String(product.currency || 'INR'),
  };
}

export const availabilityLabel = (value: string) => ({
  in_stock: 'In stock', out_of_stock: 'Out of stock', on_request: 'On request',
}[value] || 'On request');

export type Filters = {
  query: string; category: string; brand: string; form: string; stock: string; sort: string; featured: boolean;
};

export function catalogueGroups(products: Row[], filters: Filters) {
  const query = filters.query.trim().toLowerCase();
  const items = products.filter((product) => {
    const snapshot = productSnapshot(product);
    const matchesQuery = !query || [snapshot.name, snapshot.brand, snapshot.composition, snapshot.strength]
      .join(' ').toLowerCase().includes(query);
    return matchesQuery
      && (!filters.category || snapshot.category === filters.category)
      && (!filters.brand || snapshot.brand === filters.brand)
      && (!filters.form || snapshot.form_type === filters.form)
      && (!filters.stock || snapshot.availability === filters.stock)
      && (!filters.featured || Boolean(product.featured));
  }).sort((a, b) => {
    if (filters.sort === 'newest') return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    if (filters.sort === 'availability') {
      return productSnapshot(a).availability.localeCompare(productSnapshot(b).availability) || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
  const categories = [...new Set(items.map((product) => productSnapshot(product).category))].sort((a, b) => {
    const ai = categoryOrder.indexOf(a), bi = categoryOrder.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
  });
  return categories.map((category) => ({category, products: items.filter((product) => productSnapshot(product).category === category)}));
}

export function catalogueDemoProducts(): Row[] {
  const products = [
    ['Ceftriaxone', 'Injection', 'Ceftriaxone', '1 g', 'Vial'],
    ['Pantoprazole', 'Injection', 'Pantoprazole', '', 'Vial'],
    ['Ondansetron', 'Injection', 'Ondansetron', '', 'Ampoule'],
    ['Diclofenac', 'Injection', 'Diclofenac', '', 'Ampoule'],
    ['Methylcobalamin', 'Injection', 'Methylcobalamin', '', 'Ampoule'],
    ['Amikacin', 'Injection', 'Amikacin', '500 mg', 'Vial'],
    ['Gentamicin', 'Injection', 'Gentamicin', '80 mg', 'Ampoule'],
    ['Dexamethasone', 'Injection', 'Dexamethasone', '4 mg', 'Ampoule'],
    ['Furosemide', 'Injection', 'Furosemide', '20 mg', 'Ampoule'],
    ['Tramadol', 'Injection', 'Tramadol', '50 mg', 'Ampoule'],
    ['Hydrocortisone', 'Injection', 'Hydrocortisone', '100 mg', 'Vial'],
    ['Meropenem', 'Injection', 'Meropenem', '1 g', 'Vial'],
    ['Pantoprazole tablets', 'Tablet', 'Pantoprazole', '40 mg', 'Strip'],
    ['Ofloxacin tablets', 'Tablet', 'Ofloxacin', '200 mg', 'Strip'],
    ['Levocetirizine tablets', 'Tablet', 'Levocetirizine', '5 mg', 'Strip'],
    ['DSR tablets', 'Tablet', 'Domperidone + Rabeprazole', '', 'Strip'],
    ['Paracetamol tablets', 'Tablet', 'Paracetamol', '500 mg', 'Strip'],
    ['Azithromycin tablets', 'Tablet', 'Azithromycin', '500 mg', 'Strip'],
    ['Metformin tablets', 'Tablet', 'Metformin', '500 mg', 'Strip'],
    ['Amlodipine tablets', 'Tablet', 'Amlodipine', '5 mg', 'Strip'],
    ['Cetirizine tablets', 'Tablet', 'Cetirizine', '10 mg', 'Strip'],
    ['Cefixime tablets', 'Tablet', 'Cefixime', '200 mg', 'Strip'],
    ['Losartan tablets', 'Tablet', 'Losartan', '50 mg', 'Strip'],
    ['Montelukast tablets', 'Tablet', 'Montelukast', '10 mg', 'Strip'],
    ['Povidone iodine ointment', 'Ointment', 'Povidone iodine', '', 'Tube'],
    ['Itraconazole ointment', 'Ointment', 'Itraconazole', '', 'Tube'],
    ['Mupirocin ointment', 'Ointment', 'Mupirocin', '2%', 'Tube'],
    ['IV set', 'Surgical', '', '', 'Single unit'],
    ['Disposable syringe', 'Surgical', '', '5 ml', 'Single unit'],
    ['Micropore tape', 'Surgical', '', '', 'Roll'],
    ['Bandage', 'Surgical', '', '', 'Roll'],
    ['Surgical gloves', 'Surgical', '', 'Medium', 'Pair'],
    ['Cotton roll', 'General / Consumables', '', '', 'Roll'],
    ['Normal saline', 'General / Consumables', 'Sodium chloride', '0.9%', 'Bottle'],
    ['Care essentials kit', 'General / Consumables', '', '', 'Kit'],
    ['Alcohol swabs', 'General / Consumables', 'Isopropyl alcohol', '', 'Box'],
  ];
  return products.map((product, index) => ({
    id: `catalogue-demo-${index}`, name: product[0], category: product[1], composition: product[2],
    strength: product[3], pack_size: product[4],
    form_type: product[1] === 'General / Consumables' ? 'Consumable' : product[1], brand: '',
    stock: index % 7 === 0 ? 0 : 24 + index,
    availability: index % 6 === 0 ? 'on_request' : index % 7 === 0 ? 'out_of_stock' : 'in_stock',
    featured: index % 5 === 0, image_url: '',
    notes: 'Illustrative catalogue entry. Confirm manufacturer, composition, strength and pack details before live use.',
    description: 'Sample product for catalogue browsing.', currency: 'INR',
    price: index % 4 === 0 ? 120 + index * 5 : null, retailer_id: '', catalogue_id: '',
    created_at: '2026-09-16T00:00:00Z',
  }));
}
