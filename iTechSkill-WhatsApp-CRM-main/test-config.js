const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data: config } = await supabase.from('whatsapp_config').select('*').order('created_at', { ascending: false }).limit(1).single();
    console.log("Config:", config);
}
check();
