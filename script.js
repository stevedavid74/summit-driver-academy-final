const toggle=document.querySelector('.menu-toggle');
const nav=document.querySelector('.nav');
if(toggle&&nav){
  toggle.addEventListener('click',()=>{
    const open=nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');
  });
  nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded','false');
  }));
}

const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveals=[...document.querySelectorAll('.reveal')];
reveals.forEach((el,index)=>{
  const group=[...el.parentElement.children].filter(child=>child.classList&&child.classList.contains('reveal'));
  const position=group.indexOf(el);
  if(position>0) el.style.setProperty('--reveal-delay',`${Math.min(position*90,360)}ms`);
});

if(reducedMotion){
  reveals.forEach(el=>el.classList.add('visible'));
}else{
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(entry.isIntersecting){
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  }),{threshold:.1,rootMargin:'0px 0px -7% 0px'});
  reveals.forEach(el=>observer.observe(el));
}

const year=document.getElementById('year');
if(year) year.textContent=new Date().getFullYear();

// Keep the privacy notice beside consent on both language versions.
document.querySelectorAll('.consent-row span').forEach(text=>{
  const isFrench=document.documentElement.lang==='fr';
  const link=document.createElement('a');
  link.href=isFrench?'confidentialite.html':'privacy.html';
  link.textContent=isFrench?'Lire la politique de confidentialité.':'Read our privacy policy.';
  text.append(document.createTextNode(' '),link);
});


// Premium brand interactions: condensed navigation, subtle hero depth,
// and branded journey progress. All effects respect reduced-motion settings.
const header=document.querySelector('.site-header');
const journeyProgress=document.querySelector('.journey-progress');
const heroContent=document.querySelector('.hero-content');
let ticking=false;

function updatePremiumExperience(){
  const y=window.scrollY;
  if(header) header.classList.toggle('is-scrolled',y>28);

  const maxScroll=Math.max(1,document.documentElement.scrollHeight-window.innerHeight);
  if(journeyProgress){
    const progress=Math.min(1,Math.max(0,y/maxScroll));
    journeyProgress.style.height=`${progress*100}%`;
  }

  if(heroContent&&!reducedMotion&&window.innerWidth>760&&y<window.innerHeight){
    heroContent.style.transform=`translate3d(0,${Math.min(y*.075,44)}px,0)`;
  }else if(heroContent){
    heroContent.style.transform='';
  }
  ticking=false;
}

window.addEventListener('scroll',()=>{
  if(!ticking){
    window.requestAnimationFrame(updatePremiumExperience);
    ticking=true;
  }
},{passive:true});
window.addEventListener('resize',updatePremiumExperience,{passive:true});
updatePremiumExperience();


// Secure registration endpoint. The server—not the browser—assigns Founding 30
// or regular tuition and sends the matching bilingual confirmation.
const summitRegistrationConfig=window.SUMMIT_REGISTRATION||{endpoint:'https://zrnylkqtofjitxtykhxq.supabase.co/functions/v1/register'};

async function updateFoundingAvailability(){
  const remainingElements=[...document.querySelectorAll('[data-founding-remaining]')];
  if(!remainingElements.length)return;
  const lang=(document.documentElement.lang||'en').toLowerCase().startsWith('fr')?'fr':'en';
  const endpoint=summitRegistrationConfig.availabilityEndpoint;
  const statusElements=[...document.querySelectorAll('[data-founding-status]')];
  const progressElements=[...document.querySelectorAll('[data-founding-progress]')];
  const claimedElements=[...document.querySelectorAll('[data-founding-claimed]')];
  const setStatus=(value)=>statusElements.forEach((element)=>{element.textContent=value;});
  if(!endpoint){setStatus(lang==='fr'?'Disponibilité temporairement indisponible':'Availability temporarily unavailable');return;}
  try{
    const response=await fetch(endpoint,{headers:{Accept:'application/json'},cache:'no-store'});
    if(!response.ok)throw new Error(`Availability request failed: ${response.status}`);
    const data=await response.json();
    const capacity=Number(data.capacity);
    const claimed=Number(data.claimed);
    const remaining=Number(data.remaining);
    if(!Number.isFinite(capacity)||!Number.isFinite(claimed)||!Number.isFinite(remaining)||capacity<=0)throw new Error('Invalid availability response');
    remainingElements.forEach((element)=>{element.textContent=String(remaining);});
    claimedElements.forEach((element)=>{element.textContent=lang==='fr'?`${claimed} place${claimed===1?'':'s'} réservée${claimed===1?'':'s'}`:`${claimed} place${claimed===1?'':'s'} claimed`;});
    progressElements.forEach((element)=>{
      element.style.width=`${Math.min(100,Math.max(0,(claimed/capacity)*100))}%`;
      const track=element.closest('[role="progressbar"]');
      if(track){track.setAttribute('aria-valuenow',String(claimed));track.setAttribute('aria-valuemax',String(capacity));}
    });
    setStatus(lang==='fr'?'Disponibilité mise à jour automatiquement':'Availability updates automatically');
  }catch(error){
    console.error(error);
    remainingElements.forEach((element)=>{element.textContent='—';});
    claimedElements.forEach((element)=>{element.textContent='';});
    setStatus(lang==='fr'?'Disponibilité temporairement indisponible':'Availability temporarily unavailable');
  }
}

updateFoundingAvailability();
const summitRegistrationReady=Boolean(summitRegistrationConfig.endpoint);

function setFormStatus(form,message,type='info'){
  let status=form.querySelector('.form-status');
  if(!status){
    status=document.createElement('p');
    status.className='form-status';
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    form.appendChild(status);
  }
  status.dataset.type=type;
  status.textContent=message;
}

async function submitPreregistration(form){
  const lang=document.documentElement.lang==='fr'?'fr':'en';
  const button=form.querySelector('button[type="submit"]');
  const originalText=button?button.textContent:'';
  const formData=new FormData(form);

  // Honeypot: silently accept bot submissions without saving data.
  if(String(formData.get('bot-field')||'').trim()) return;

  const payload={
    name:String(formData.get('name')||'').trim(),
    email:String(formData.get('email')||'').trim(),
    phone:String(formData.get('phone')||'').trim(),
    preferredInstructor:String(formData.get('preferred-instructor')||'no_preference').trim(),
    preferredWeekStart:String(formData.get('preferred-week')||'').trim(),
    language:lang,
    consent:formData.get('consent')==='on'
  };

  if(!payload.name||!payload.email||!payload.phone||!payload.preferredWeekStart||!payload.consent){
    setFormStatus(
      form,
      lang==='fr'?'Veuillez remplir tous les champs et confirmer votre consentement.':'Please complete every field and confirm your consent.',
      'error'
    );
    return;
  }

  if(button){
    button.disabled=true;
    button.textContent=lang==='fr'?'Envoi en cours…':'Submitting…';
  }
  setFormStatus(form,lang==='fr'?'Enregistrement de votre préinscription…':'Saving your pre-registration…');

  try{
    const response=await fetch(summitRegistrationConfig.endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });

    if(!response.ok){
      const details=await response.text();
      throw new Error(`Registration ${response.status}: ${details}`);
    }

    const registration=await response.json();
    if(!registration.reference||!['founding','regular'].includes(registration.tier)||![900,1200].includes(Number(registration.price))){
      throw new Error('Registration service returned an invalid response');
    }

    setFormStatus(form,lang==='fr'?'Préinscription enregistrée. Redirection…':'Pre-registration saved. Redirecting…','success');
    const destination=lang==='fr'?'merci.html':'thank-you.html';
    const query=new URLSearchParams({
      tier:registration.tier,
      price:String(registration.price),
      reference:registration.reference
    });
    window.location.href=`${destination}?${query}`;
  }catch(error){
    console.error('Pre-registration submission failed:',error);
    setFormStatus(
      form,
      lang==='fr'?'Impossible d’envoyer la préinscription pour le moment. Veuillez réessayer ou nous appeler.':'We could not submit your pre-registration. Please try again or call us.',
      'error'
    );
    if(button){
      button.disabled=false;
      button.textContent=originalText;
    }
  }
}

document.querySelectorAll('input[name="preferred-week"]').forEach(input=>{
  input.min='2026-10-05';
  input.step='7';
});

document.querySelectorAll('.prereg-form').forEach(form=>{
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(!summitRegistrationReady){
      setFormStatus(
        form,
        document.documentElement.lang==='fr'
          ?'Le service d’inscription est temporairement indisponible. Veuillez nous appeler.'
          :'The registration service is temporarily unavailable. Please call us.',
        'error'
      );
      return;
    }
    submitPreregistration(form);
  });
});
