import type {SupabaseClient} from '@supabase/supabase-js';

export async function signOutSession(client: SupabaseClient) {
  const {error} = await client.auth.signOut();
  if (error) throw error;
}
