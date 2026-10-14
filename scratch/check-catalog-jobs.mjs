import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data: rpcList, error: rpcErr } = await db.rpc("itechskill_publish_catalog_job");
  console.log("No args call:", rpcErr ? rpcErr.message : rpcList);
}

test().catch(console.error);
