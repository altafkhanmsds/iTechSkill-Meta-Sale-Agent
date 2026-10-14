const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const META_API_BASE = 'https://graph.facebook.com/v21.0';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
function decrypt(encryptedText) {
  const parts = encryptedText.split(':')
  if (parts.length === 3) {
    const [ivHex, ctHex, tagHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(tagHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv)
    decipher.setAuthTag(authTag)
    let decrypted = decipher.update(ctHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }
}

async function check() {
  try {
    const { data: config } = await supabase.from('whatsapp_config').select('access_token').order('created_at', { ascending: false }).limit(1).single();
    let token = config.access_token;
    try { token = decrypt(token); } catch(e) { console.error("decrypt err:", e) }
    
    console.log("Token starts with:", token.substring(0, 10));

    const mediaId = "2459469894545311"; // Use the one that is "verified"
    const res = await fetch(`${META_API_BASE}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
    console.log("Graph Response:", res.status, await res.text());

  } catch(e) { console.error(e) }
}
check();
