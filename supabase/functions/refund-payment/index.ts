import { createClient } from 'npm:@supabase/supabase-js@2.112.2'
import Stripe from 'npm:stripe@22.0.0'

const allowedOrigins=new Set(['https://summitdriveracademy.com','https://www.summitdriveracademy.com'])
Deno.serve(async(request)=>{
  const origin=request.headers.get('origin')||''
  if(request.method==='OPTIONS')return json({ok:true},200,origin)
  if(request.method!=='POST')return json({error:'Method not allowed'},405,origin)
  const authorization=request.headers.get('authorization');if(!authorization)return json({error:'Authentication required'},401,origin)
  const supabaseUrl=Deno.env.get('SUPABASE_URL')||'',anonKey=Deno.env.get('SUPABASE_ANON_KEY')||'',secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}'),serviceKey=secretKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',stripeKey=Deno.env.get('STRIPE_TEST_SECRET_KEY')||''
  if(!stripeKey.startsWith('sk_test_'))return json({error:'Stripe sandbox is not connected yet.'},503,origin)
  const caller=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}}),admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}})
  const {data:authData}=await caller.auth.getUser();if(!authData.user)return json({error:'Authentication required'},401,origin)
  const {data:operator}=await admin.from('staff_profiles').select('role').eq('user_id',authData.user.id).in('role',['owner','manager']).eq('is_active',true).maybeSingle();if(!operator)return json({error:'Manager or owner access required'},403,origin)
  let body:{payment_id?:string};try{body=await request.json()}catch{return json({error:'Invalid request'},400,origin)}
  const {data:payment}=await admin.from('student_payments').select('*').eq('id',String(body.payment_id||'')).eq('environment','test').maybeSingle()
  if(!payment||payment.status!=='paid'||!payment.stripe_payment_intent_id)return json({error:'Only a paid sandbox payment can be refunded.'},409,origin)
  const stripe=new Stripe(stripeKey),refund=await stripe.refunds.create({payment_intent:payment.stripe_payment_intent_id,metadata:{payment_record_id:payment.id,environment:'test'}},{idempotencyKey:`summit-refund-${payment.id}`})
  const {error}=await admin.from('student_payments').update({status:'refunded',stripe_refund_id:refund.id,refunded_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',payment.id)
  return error?json({error:error.message},400,origin):json({success:true,status:'refunded'},200,origin)
})
function json(payload:unknown,status:number,origin:string){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json','access-control-allow-origin':allowedOrigins.has(origin)?origin:'https://summitdriveracademy.com','access-control-allow-headers':'authorization, x-client-info, apikey, content-type','access-control-allow-methods':'POST, OPTIONS','vary':'origin'}})}
