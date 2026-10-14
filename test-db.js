const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await supabase.from('itechskill_enrollment_applications').select('application_id, payment_screenshot_media_id, payment_status');
  console.log("Error:", error);
  console.log("Data:", JSON.stringify(data, null, 2));
}

check();
