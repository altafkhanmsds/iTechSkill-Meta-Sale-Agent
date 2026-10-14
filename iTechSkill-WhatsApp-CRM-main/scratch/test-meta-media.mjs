import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config({ path: '.env' });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
console.log('ENCRYPTION_KEY exists:', !!ENCRYPTION_KEY);

function decrypt(encryptedText) {
  const parts = encryptedText.split(':');
  if (parts.length === 3) {
    const [ivHex, ctHex, tagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ctHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
  if (parts.length === 2) {
    const [ivHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let decrypted = decipher.update(ctHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
  return encryptedText;
}

async function test() {
  const { data: config } = await db.from('whatsapp_config').select('*').limit(1).single();
  const token = decrypt(config.access_token);
  console.log('Decrypted token length:', token.length, 'starts with:', token.slice(0, 15));

  const res = await fetch('https://graph.facebook.com/v21.0/2459469894545311', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('Meta API status:', res.status);
  const data = await res.json();
  console.log('Meta API response for media 2459469894545311:', JSON.stringify(data, null, 2));

  // Let's also check if the token itself is valid by checking /me or phone_number_id
  const checkToken = await fetch(`https://graph.facebook.com/v21.0/${config.phone_number_id}`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('Phone number status:', checkToken.status);
  const phoneData = await checkToken.json();
  console.log('Phone number data:', JSON.stringify(phoneData, null, 2));
}
test();
