import { createClient } from 'npm:@supabase/supabase-js@2.112.2'
import Stripe from 'npm:stripe@22.0.0'

const allowedOrigins = new Set(['https://summitdriveracademy.com','https://www.summitdriveracademy.com'])

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || ''
  if (request.method === 'OPTIONS') return json({ ok: true }, 200, origin)
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)
  const authorization = request.headers.get('authorization')
  if (!authorization) return json({ error: 'Authentication required' }, 401, origin)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
  const serviceKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const stripeKey = Deno.env.get('STRIPE_TEST_SECRET_KEY') || ''
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server configuration error' }, 500, origin)
  if (!stripeKey.startsWith('sk_test_')) return json({ error: 'Stripe sandbox is not connected yet.' }, 503, origin)

  const caller = createClient(supabaseUrl, anonKey, { global:{headers:{Authorization:authorization}}, auth:{persistSession:false} })
  const admin = createClient(supabaseUrl, serviceKey, { auth:{persistSession:false} })
  const { data:authData,error:authError } = await caller.auth.getUser()
  if (authError || !authData.user) return json({ error: 'Authentication required' }, 401, origin)
  const { data:operator } = await admin.from('staff_profiles').select('user_id,role,is_active').eq('user_id',authData.user.id).in('role',['owner','manager']).eq('is_active',true).maybeSingle()
  if (!operator) return json({ error: 'Manager or owner access required' }, 403, origin)

  let body:{student_id?:string;tuition_tier?:string}
  try { body = await request.json() } catch { return json({ error: 'Invalid request' }, 400, origin) }
  const studentId=String(body.student_id||''),tier=String(body.tuition_tier||'')
  if (!studentId || !['founding','regular'].includes(tier)) return json({ error: 'Student and tuition tier are required' }, 400, origin)
  const { data:settings } = await admin.from('payment_settings').select('*').eq('singleton',true).single()
  if (!settings || settings.stripe_mode!=='test' || settings.live_payments_enabled) return json({ error: 'Sandbox payments are not enabled safely.' }, 409, origin)
  const { data:student } = await admin.from('students').select('id,full_name,email,registration_id,status').eq('id',studentId).maybeSingle()
  if (!student) return json({ error: 'Student not found' }, 404, origin)
  if (!student.email) return json({ error: 'Add the student email before creating checkout.' }, 409, origin)
  const amount=tier==='founding'?90000:120000
  const { data:payment,error:insertError } = await admin.from('student_payments').insert({student_id:student.id,registration_id:student.registration_id,environment:'test',tuition_tier:tier,amount_cents:amount,tax_cents:0,currency:'cad',status:'draft',created_by:authData.user.id,metadata:{source:'owner_portal'}}).select('*').single()
  if (insertError) return json({ error: insertError.message }, 400, origin)

  try {
    const stripe=new Stripe(stripeKey)
    const session=await stripe.checkout.sessions.create({
      mode:'payment',customer_email:student.email,
      line_items:[{price_data:{currency:'cad',unit_amount:amount,product_data:{name:tier==='founding'?'Summit Driver Academy — Founding 30 tuition':'Summit Driver Academy — Tuition'}},quantity:1}],
      success_url:'https://summitdriveracademy.com/portal/?payment=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url:'https://summitdriveracademy.com/portal/?payment=cancelled',
      metadata:{payment_record_id:payment.id,student_id:student.id,environment:'test',tuition_tier:tier},
      payment_intent_data:{metadata:{payment_record_id:payment.id,student_id:student.id,environment:'test'}},
    },{idempotencyKey:`summit-checkout-${payment.id}`})
    const { error:updateError }=await admin.from('student_payments').update({status:'checkout_created',stripe_checkout_session_id:session.id,checkout_url:session.url,updated_at:new Date().toISOString()}).eq('id',payment.id)
    if (updateError) throw updateError
    return json({success:true,payment_id:payment.id,checkout_url:session.url,status:'checkout_created',environment:'test'},200,origin)
  } catch(error){
    await admin.from('student_payments').update({status:'failed',updated_at:new Date().toISOString(),metadata:{source:'owner_portal',checkout_error:String(error)}}).eq('id',payment.id)
    return json({error:'Stripe could not create the sandbox checkout.'},502,origin)
  }
})

function json(payload:unknown,status:number,origin:string){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json','access-control-allow-origin':allowedOrigins.has(origin)?origin:'https://summitdriveracademy.com','access-control-allow-headers':'authorization, x-client-info, apikey, content-type','access-control-allow-methods':'POST, OPTIONS','vary':'origin'}})}
