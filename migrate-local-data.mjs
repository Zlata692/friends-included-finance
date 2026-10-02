import { readFile } from 'node:fs/promises';
import { saveSupabaseState, hasSupabase } from './integrations.mjs';

if (!hasSupabase()) {
  throw new Error('Add SUPABASE_URL and SUPABASE_SECRET_KEY to .env first.');
}

const state = JSON.parse(await readFile(new URL('./data.json', import.meta.url), 'utf8'));
await saveSupabaseState(state);
console.log(`Migrated ${state.records.length} records and ${state.employees.length} employees to Supabase.`);
