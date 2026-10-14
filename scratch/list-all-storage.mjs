import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function listAllStorage() {
  const { data: buckets, error: bErr } = await db.storage.listBuckets();
  console.log('Buckets:', buckets, bErr);

  if (buckets) {
    for (const b of buckets) {
      console.log(`\n--- Bucket: ${b.name} (id: ${b.id}, public: ${b.public}) ---`);
      const { data: files, error: fErr } = await db.storage.from(b.name).list('', { limit: 100 });
      console.log(`Root files in ${b.name}:`, files, fErr);

      if (files) {
        for (const item of files) {
          if (!item.id) { // likely folder
            const { data: subFiles } = await db.storage.from(b.name).list(item.name, { limit: 100 });
            console.log(`Files in ${b.name}/${item.name}:`, subFiles);
          }
        }
      }
    }
  }
}
listAllStorage();
