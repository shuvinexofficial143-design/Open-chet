import {z} from 'zod';
import {context, db, failure} from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await context(request);
    const params = new URL(request.url).searchParams;
    const limit = z.coerce.number().int().min(1).max(500).catch(300).parse(params.get('limit'));
    const offset = z.coerce.number().int().min(0).catch(0).parse(params.get('offset'));
    const query = z.string().trim().max(120).catch('').parse(params.get('q') || '');
    const category = z.string().trim().max(100).catch('').parse(params.get('category') || '');
    const pattern = `%${query}%`;
    const rows = await db()`
      select * from products
      where organization_id=${auth.org}
        and (${category}='' or category=${category})
        and (${query}='' or concat_ws(' ',name,brand,composition,strength) ilike ${pattern})
      order by category,name,id
      limit ${limit + 1} offset ${offset}
    `;
    return Response.json({products: rows.slice(0, limit), has_more: rows.length > limit, offset, limit}, {
      headers: {'Cache-Control': 'private, no-store'},
    });
  } catch (error) {
    return failure(error);
  }
}
