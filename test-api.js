require('dotenv').config({ path: '.env' });

async function check() {
  try {
    const res = await fetch('http://localhost:3000/api/ops/admissions/receipt-preview?mediaId=2268002207072203', {
      // Need auth? Oh wait, the route requires agent role!
      // `await requireRole("agent")` is called.
    });
    console.log("Status:", res.status);
    console.log("Text:", await res.text());
  } catch(e) { console.error(e) }
}
check();
