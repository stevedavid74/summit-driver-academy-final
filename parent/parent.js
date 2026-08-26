(() => {
  'use strict';
  const copy = {
    en:{portalName:'Family Progress Portal',signOut:'Sign out',privateAccess:'Private family access',welcome:'Your student’s progress, clearly communicated.',loginIntro:'Sign in with the secure account invitation provided by Summit Driver Academy.',email:'Email',password:'Password',signIn:'Sign in securely',secureSetup:'Secure account setup',createPassword:'Create your family portal password.',setupIntro:'Choose a unique password. Do not reuse your email password.',newPassword:'New password',confirmPassword:'Confirm password',savePassword:'Save password and enter portal',dashboard:'Family dashboard',protected:'Protected account',studentProgress:'Student progress',onlineTraining:'Online training',inCarTraining:'In-car training',summitScore:'Summit score',currentFocus:'Current focus',nextLesson:'Next lesson',trainingWeek:'Training week',roadTestReadiness:'Road-test readiness',sharedReports:'Shared lesson reports',recentProgress:'Recent progress',noReports:'No lesson summaries have been shared yet.',noStudents:'No student has been connected to this family account yet.',hours:'hours',lesson:'Lesson',minutes:'minutes',instructorNotes:'Instructor notes',overall:'Overall',observation:'Observation',intersections:'Intersections',lane:'Lane control',parking:'Parking',defensive:'Defensive driving',authFailed:'The email or password is incorrect.',notAuthorized:'This account does not have active Summit family access.',loadFailed:'The family portal could not load. Please try again.',passwordMismatch:'The passwords do not match.',passwordTooShort:'Your password must contain at least 12 characters.',setupFailed:'Your password could not be saved. Please request a new invitation.'},
    fr:{portalName:'Portail de progrès familial',signOut:'Déconnexion',privateAccess:'Accès privé familial',welcome:'Les progrès de votre élève, communiqués clairement.',loginIntro:'Connectez-vous avec l’invitation sécurisée fournie par l’Académie de conduite Summit.',email:'Courriel',password:'Mot de passe',signIn:'Connexion sécurisée',secureSetup:'Configuration sécurisée',createPassword:'Créez le mot de passe du portail familial.',setupIntro:'Choisissez un mot de passe unique. Ne réutilisez pas votre mot de passe de courriel.',newPassword:'Nouveau mot de passe',confirmPassword:'Confirmer le mot de passe',savePassword:'Enregistrer et accéder au portail',dashboard:'Tableau de bord familial',protected:'Compte protégé',studentProgress:'Progrès de l’élève',onlineTraining:'Formation en ligne',inCarTraining:'Formation en voiture',summitScore:'Résultat Summit',currentFocus:'Objectif actuel',nextLesson:'Prochaine leçon',trainingWeek:'Semaine de formation',roadTestReadiness:'Préparation à l’examen routier',sharedReports:'Rapports de leçon partagés',recentProgress:'Progrès récents',noReports:'Aucun résumé de leçon n’a encore été partagé.',noStudents:'Aucun élève n’est encore lié à ce compte familial.',hours:'heures',lesson:'Leçon',minutes:'minutes',instructorNotes:'Notes du moniteur',overall:'Note globale',observation:'Observation',intersections:'Intersections',lane:'Maîtrise de la voie',parking:'Stationnement',defensive:'Conduite préventive',authFailed:'Le courriel ou le mot de passe est incorrect.',notAuthorized:'Ce compte ne dispose pas d’un accès familial Summit actif.',loadFailed:'Le portail familial n’a pas pu être chargé. Veuillez réessayer.',passwordMismatch:'Les mots de passe ne correspondent pas.',passwordTooShort:'Votre mot de passe doit contenir au moins 12 caractères.',setupFailed:'Votre mot de passe n’a pas pu être enregistré. Veuillez demander une nouvelle invitation.'}
  };
  const $ = selector => document.querySelector(selector);
  const config = window.SUMMIT_PORTAL_CONFIG;
  const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  let lang = localStorage.getItem('summitParentLanguage') || 'en';
  let students = [], reports = [], selectedId = null;

  const escapeHtml = (value='') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const message = (element,text,error=false) => {element.textContent=text;element.classList.toggle('error',error)};
  const isSetupLink = () => /(?:^|[?&#])(type=(?:invite|recovery)|access_token=|code=)/.test(`${location.search}&${location.hash.replace(/^#/,'')}`);
  const dateOnly = value => value ? new Intl.DateTimeFormat(lang==='fr'?'fr-CA':'en-CA',{dateStyle:'medium'}).format(new Date(`${value}T12:00:00`)) : '—';
  const dateTime = value => value ? new Intl.DateTimeFormat(lang==='fr'?'fr-CA':'en-CA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—';
  const weekText = value => {if(!value)return '—';const start=new Date(`${value}T12:00:00`),end=new Date(start);end.setDate(end.getDate()+4);return `${dateOnly(value)} – ${new Intl.DateTimeFormat(lang==='fr'?'fr-CA':'en-CA',{month:'short',day:'numeric'}).format(end)}`};
  function translate(){document.documentElement.lang=lang;document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=copy[lang][el.dataset.i18n]});$('#languageToggle').textContent=lang==='en'?'FR':'EN';localStorage.setItem('summitParentLanguage',lang);render()}
  function showSetup(){$('#loginView').classList.add('hidden');$('#portalView').classList.add('hidden');$('#passwordSetupView').classList.remove('hidden');$('#signOutButton').classList.add('hidden')}

  async function loadPortal(user){
    const {data:profile,error:profileError}=await client.from('parent_profiles').select('full_name,preferred_language,is_active').eq('user_id',user.id).maybeSingle();
    if(profileError||!profile||!profile.is_active){await client.auth.signOut();return message($('#loginMessage'),copy[lang].notAuthorized,true)}
    lang=profile.preferred_language||lang;$('#guardianGreeting').textContent=profile.full_name;
    const {data:links,error:linkError}=await client.from('student_guardians').select('student_id').eq('guardian_id',user.id);
    if(linkError)return message($('#portalMessage'),copy[lang].loadFailed,true);
    const ids=(links||[]).map(link=>link.student_id);
    if(ids.length){
      const [{data:studentData,error:studentError},{data:reportData,error:reportError}]=await Promise.all([
        client.from('students').select('id,full_name,preferred_language,status,online_hours,in_car_hours,summit_score,road_test_readiness,current_focus,next_lesson_at,training_week_start').in('id',ids).order('full_name'),
        client.rpc('get_parent_lesson_reports')
      ]);
      if(studentError||reportError)return message($('#portalMessage'),copy[lang].loadFailed,true);
      students=studentData||[];reports=reportData||[];selectedId=students[0]?.id||null;
    }
    $('#loginView').classList.add('hidden');$('#passwordSetupView').classList.add('hidden');$('#portalView').classList.remove('hidden');$('#signOutButton').classList.remove('hidden');translate();
  }
  function scorePill(label,value){return value==null?'':`<span>${escapeHtml(label)}: ${Number(value)}%</span>`}
  function render(){
    if(!$('#studentTabs'))return;
    $('#studentTabs').innerHTML=students.map(student=>`<button class="${student.id===selectedId?'active':''}" data-student="${student.id}" type="button">${escapeHtml(student.full_name)}</button>`).join('');
    $('#emptyStudents').classList.toggle('hidden',students.length>0);$('#studentView').classList.toggle('hidden',students.length===0);
    const student=students.find(item=>item.id===selectedId);if(!student)return;
    $('#studentName').textContent=student.full_name;$('#studentStatus').textContent=student.status;
    $('#onlineProgress').value=Number(student.online_hours||0);$('#onlineValue').textContent=`${Number(student.online_hours||0)}/30 ${copy[lang].hours}`;
    $('#carProgress').value=Number(student.in_car_hours||0);$('#carValue').textContent=`${Number(student.in_car_hours||0)}/10 ${copy[lang].hours}`;
    $('#scoreProgress').value=Number(student.summit_score||0);$('#scoreValue').textContent=student.summit_score==null?'—':`${student.summit_score}%`;
    $('#currentFocus').textContent=student.current_focus||'—';$('#nextLesson').textContent=dateTime(student.next_lesson_at);$('#trainingWeek').textContent=weekText(student.training_week_start);$('#roadTestReadiness').textContent=student.road_test_readiness==null?'—':`${student.road_test_readiness}%`;
    const visible=reports.filter(report=>report.student_id===student.id);$('#emptyReports').classList.toggle('hidden',visible.length>0);
    $('#reportList').innerHTML=visible.map(report=>`<article class="report"><header><h3>${copy[lang].lesson} · ${dateOnly(report.lesson_date)}</h3><small>${Number(report.duration_minutes)} ${copy[lang].minutes}</small></header>${report.lesson_notes?`<p><strong>${copy[lang].instructorNotes}</strong><br>${escapeHtml(report.lesson_notes)}</p>`:''}${report.parent_summary?`<p>${escapeHtml(report.parent_summary)}</p>`:''}<div class="scores">${scorePill(copy[lang].overall,report.overall_score)}${scorePill(copy[lang].observation,report.observation_score)}${scorePill(copy[lang].intersections,report.intersections_score)}${scorePill(copy[lang].lane,report.lane_control_score)}${scorePill(copy[lang].parking,report.parking_score)}${scorePill(copy[lang].defensive,report.defensive_driving_score)}</div></article>`).join('');
  }

  $('#loginForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;const {data,error}=await client.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});button.disabled=false;if(error)return message($('#loginMessage'),copy[lang].authFailed,true);await loadPortal(data.user)});
  $('#passwordSetupForm').addEventListener('submit',async event=>{event.preventDefault();const password=$('#newPassword').value;if(password.length<12)return message($('#passwordSetupMessage'),copy[lang].passwordTooShort,true);if(password!==$('#confirmPassword').value)return message($('#passwordSetupMessage'),copy[lang].passwordMismatch,true);const button=event.submitter;button.disabled=true;const {data,error}=await client.auth.updateUser({password});button.disabled=false;if(error)return message($('#passwordSetupMessage'),copy[lang].setupFailed,true);history.replaceState(null,'',location.pathname);await loadPortal(data.user)});
  $('#studentTabs').addEventListener('click',event=>{const button=event.target.closest('[data-student]');if(button){selectedId=button.dataset.student;render()}});
  $('#languageToggle').addEventListener('click',()=>{lang=lang==='en'?'fr':'en';translate()});$('#signOutButton').addEventListener('click',async()=>{await client.auth.signOut();location.reload()});
  client.auth.onAuthStateChange((event,session)=>{if(session&&isSetupLink()&&(event==='PASSWORD_RECOVERY'||event==='SIGNED_IN'))showSetup()});
  translate();client.auth.getSession().then(({data})=>{if(!data.session)return;if(isSetupLink())showSetup();else loadPortal(data.session.user)});
})();
