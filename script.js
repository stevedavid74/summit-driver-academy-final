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


// Netlify handles Founding 50 form submissions after deployment.
// During local Live Server preview, prevent a misleading submission and show a clear notice.
document.querySelectorAll('.prereg-form').forEach(form=>{
  form.addEventListener('submit',event=>{
    if(location.hostname==='127.0.0.1'||location.hostname==='localhost'){
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      if(button){
        const original=button.textContent;
        button.textContent=document.documentElement.lang==='fr'?'Aucune donnée envoyée en aperçu local':'Local preview — no data sent';
        setTimeout(()=>button.textContent=original,3200);
      }
    }
  });
});


/* Founding 50 availability counter.
   Change data-reserved="0" in both HTML files as real pre-registrations arrive. */
document.querySelectorAll(".founding-counter").forEach((counter) => {
  const total = Number(counter.dataset.total || 50);
  const reserved = Math.min(total, Math.max(0, Number(counter.dataset.reserved || 0)));
  const remaining = total - reserved;
  const percent = Math.round((reserved / total) * 100);

  counter.querySelectorAll(".founding-remaining").forEach((el) => {
    el.textContent = String(remaining);
  });
  counter.querySelectorAll(".founding-reserved").forEach((el) => {
    el.textContent = String(reserved);
  });
  counter.querySelectorAll(".founding-percent").forEach((el) => {
    el.textContent = String(percent);
  });

  const fill = counter.querySelector(".founding-progress-fill");
  const track = counter.querySelector(".founding-progress-track");
  if (track) track.setAttribute("aria-valuenow", String(reserved));
  if (fill) {
    requestAnimationFrame(() => {
      fill.style.width = `${percent}%`;
    });
  }
});
