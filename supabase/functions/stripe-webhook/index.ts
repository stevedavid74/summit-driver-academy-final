import { createClient } from 'npm:@supabase/supabase-js@2.112.2'
import Stripe from 'npm:stripe@22.0.0'

Deno.serve(async(request)=>{
  if(request.method!=='POST')return new Response('Method not allowed',{status:405})
  const stripeKey=Deno.env.get('STRIPE_TEST_SECRET_KEY')||'',webhookSecret=Deno.env.get('STRIPE_TEST_WEBHOOK_SECRET')||''
  if(!stripeKey.startsWith('sk_test_')||!webhookSecret.startsWith('whsec_'))return new Response('Sandbox webhook is not configured',{status:503})
  const signature=request.headers.get('stripe-signature')||'',body=await request.text(),stripe=new Stripe(stripeKey),cryptoProvider=Stripe.createSubtleCryptoProvider()
  let event:Stripe.Event
  try{event=await stripe.webhooks.constructEventAsync(body,signature,webhookSecret,undefined,cryptoProvider)}catch{return new Response('Invalid signature',{status:400})}
  if(event.livemode)return new Response('Live Stripe events are disabled',{status:409})
  const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}'),serviceKey=secretKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  const admin=createClient(Deno.env.get('SUPABASE_URL')||'',serviceKey,{auth:{persistSession:false}})
  if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
    const session=event.data.object as Stripe.Checkout.Session,paymentId=session.metadata?.payment_record_id
    const paymentIntentId=typeof session.payment_intent==='string'?session.payment_intent:null
    let receiptUrl:string|null=null
    if(paymentIntentId){
      const paymentIntent=await stripe.paymentIntents.retrieve(paymentIntentId,{expand:['latest_charge']})
      const charge=paymentIntent.latest_charge
      if(charge&&typeof charge!=='string')receiptUrl=charge.receipt_url
    }
    if(paymentId&&session.metadata?.environment==='test')await admin.from('student_payments').update({status:'paid',stripe_payment_intent_id:paymentIntentId,stripe_customer_id:typeof session.customer==='string'?session.customer:null,receipt_url:receiptUrl,paid_at:new Date(event.created*1000).toISOString(),updated_at:new Date().toISOString()}).eq('id',paymentId).eq('environment','test')
  }else if(event.type==='checkout.session.async_payment_failed'){
    const session=event.data.object as Stripe.Checkout.Session,paymentId=session.metadata?.payment_record_id
    if(paymentId)await admin.from('student_payments').update({status:'failed',updated_at:new Date().toISOString()}).eq('id',paymentId).eq('environment','test')
  }else if(event.type==='charge.refunded'){
    const charge=event.data.object as Stripe.Charge,pi=typeof charge.payment_intent==='string'?charge.payment_intent:null
    if(pi)await admin.from('student_payments').update({status:charge.amount_refunded===charge.amount?'refunded':'partially_refunded',refunded_at:new Date(event.created*1000).toISOString(),receipt_url:charge.receipt_url,updated_at:new Date().toISOString()}).eq('stripe_payment_intent_id',pi).eq('environment','test')
  }
  return Response.json({received:true})
})
