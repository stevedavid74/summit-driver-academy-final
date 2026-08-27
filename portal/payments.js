(() => {
  'use strict'
  const money = new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'})
  let canManage=false,student=null,payments=[]
  const $=selector=>document.querySelector(selector)
  const portal=()=>window.SummitPortal

  window.addEventListener('summit:portal-ready',event=>{canManage=Boolean(event.detail?.canManage);if(canManage&&portal().selected)selectStudent(portal().selected)})
  window.addEventListener('summit:student-selected',event=>{if(canManage)selectStudent(event.detail.student)})
  window.addEventListener('focus',()=>{if(canManage&&student)loadPayments()})

  async function selectStudent(next){student=next;$('#paymentsPanel').classList.remove('hidden');await loadPayments()}
  async function loadPayments(){
    const {data,error}=await portal().client.from('student_payments').select('id,student_id,environment,tuition_tier,amount_cents,tax_cents,currency,status,checkout_url,receipt_url,created_at,paid_at,refunded_at').eq('student_id',student.id).order('created_at',{ascending:false})
    if(error){setMessage(error.message,true);return}payments=data||[];render()
  }
  function render(){
    $('#emptyPayments').classList.toggle('hidden',payments.length>0)
    $('#paymentHistory').innerHTML=payments.map(payment=>{
      const date=new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(payment.created_at))
      const checkout=payment.checkout_url&&payment.status==='checkout_created'?`<a href="${escapeHtml(payment.checkout_url)}" target="_blank" rel="noopener">Open checkout</a><button type="button" data-copy="${payment.id}">Copy link</button>`:''
      const receipt=payment.receipt_url?`<a href="${escapeHtml(payment.receipt_url)}" target="_blank" rel="noopener">Receipt</a>`:''
      const refund=payment.status==='paid'?`<button class="danger" type="button" data-refund="${payment.id}">Refund test payment</button>`:''
      return `<article class="payment-row"><div class="payment-row-main"><strong>${payment.tuition_tier==='founding'?'Founding 30':'Regular tuition'} — ${money.format(payment.amount_cents/100)}</strong><small>${date} · Tax off · ${payment.environment.toUpperCase()}</small></div><div class="payment-row-actions"><span class="payment-status ${payment.status}">${escapeHtml(payment.status.replaceAll('_',' '))}</span>${checkout}${receipt}${refund}</div></article>`
    }).join('')
  }
  $('#createCheckoutButton').addEventListener('click',async()=>{
    if(!student)return
    const tier=$('#paymentTier').value,label=tier==='founding'?'$900.00 Founding 30':'$1,200.00 regular tuition'
    if(!confirm(`Create a Stripe sandbox checkout for ${student.full_name} at ${label}? No real money can be charged.`))return
    const button=$('#createCheckoutButton');button.disabled=true;setMessage('Creating secure sandbox checkout…')
    const popup=window.open('about:blank','_blank')
    const {data,error}=await portal().client.functions.invoke('create-checkout-session',{body:{student_id:student.id,tuition_tier:tier}})
    button.disabled=false
    if(error||data?.error){if(popup)popup.close();setMessage(data?.error||error.message,true);return}
    setMessage('Sandbox checkout created. Use a Stripe test card only.');await loadPayments();if(popup&&data.checkout_url)popup.location=data.checkout_url
  })
  $('#paymentHistory').addEventListener('click',async event=>{
    const copy=event.target.closest('[data-copy]')
    if(copy){const payment=payments.find(item=>item.id===copy.dataset.copy);if(payment?.checkout_url){await navigator.clipboard.writeText(payment.checkout_url);setMessage('Sandbox checkout link copied. It cannot collect real money.')}return}
    const refund=event.target.closest('[data-refund]');if(!refund)return
    if(!confirm('Refund this sandbox payment? This affects test data only.'))return
    refund.disabled=true;const {data,error}=await portal().client.functions.invoke('refund-payment',{body:{payment_id:refund.dataset.refund}});refund.disabled=false
    if(error||data?.error){setMessage(data?.error||error.message,true);return}setMessage('Sandbox payment refunded.');await loadPayments()
  })
  function setMessage(value,error=false){const el=$('#paymentMessage');el.textContent=value||'';el.classList.toggle('error',error)}
  function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
})()
