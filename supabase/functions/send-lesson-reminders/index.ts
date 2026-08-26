import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'

const ownerEmail = 'info@summitdriveracademy.com'
const windowMinutes = 15

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const suppliedKey = request.headers.get('apikey') || ''
  const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}')
  const expectedKey = publishableKeys.default || Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!expectedKey || suppliedKey !== expectedKey) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
  const serviceKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server configuration error' }, 500)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  let body: { dry_run?: boolean } = {}
  try { body = await request.json() } catch { /* Empty body is valid. */ }

  const now = new Date()
  const start = new Date(now.getTime() + (24 * 60 - windowMinutes) * 60_000)
  const end = new Date(now.getTime() + (24 * 60 + windowMinutes) * 60_000)
  const queryStart = body.dry_run ? now : start
  const queryEnd = body.dry_run ? new Date(now.getTime() + 48 * 60 * 60_000) : end

  const { data: students, error: studentError } = await admin.from('students')
    .select('id,full_name,email,preferred_language,instructor_id,assigned_instructor_code,next_lesson_at,scheduled_duration_minutes,status')
    .eq('status', 'active')
    .not('next_lesson_at', 'is', null)
    .gte('next_lesson_at', queryStart.toISOString())
    .lte('next_lesson_at', queryEnd.toISOString())
    .order('next_lesson_at')

  if (studentError) return json({ error: studentError.message }, 500)

  const results: Array<Record<string, unknown>> = []
  for (const student of students || []) {
    const recipients = await reminderRecipients(admin, student)
    if (body.dry_run) {
      results.push({ student_id: student.id, lesson_at: student.next_lesson_at, recipient_count: recipients.length })
      continue
    }

    const { data: existing } = await admin.from('lesson_reminder_deliveries')
      .select('id,status')
      .eq('student_id', student.id)
      .eq('lesson_at', student.next_lesson_at)
      .maybeSingle()
    if (existing?.status === 'sent' || existing?.status === 'processing') {
      results.push({ student_id: student.id, status: 'skipped' })
      continue
    }

    const deliveryId = existing?.id || crypto.randomUUID()
    const { error: claimError } = await admin.from('lesson_reminder_deliveries').upsert({
      id: deliveryId,
      student_id: student.id,
      lesson_at: student.next_lesson_at,
      status: 'processing',
      error_message: null,
      recipient_count: recipients.length,
    }, { onConflict: 'student_id,lesson_at' })
    if (claimError) {
      results.push({ student_id: student.id, status: 'claim_failed' })
      continue
    }

    try {
      if (!recipients.length) throw new Error('No reminder recipients')
      await sendReminder({
        recipients,
        studentName: student.full_name,
        instructorName: await instructorName(admin, student),
        language: student.preferred_language,
        lessonAt: student.next_lesson_at,
        duration: student.scheduled_duration_minutes || 120,
      })
      await admin.from('lesson_reminder_deliveries').update({
        status: 'sent', sent_at: new Date().toISOString(), error_message: null,
      }).eq('id', deliveryId)
      results.push({ student_id: student.id, status: 'sent', recipient_count: recipients.length })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reminder delivery failed'
      await admin.from('lesson_reminder_deliveries').update({
        status: 'failed', error_message: message.slice(0, 500),
      }).eq('id', deliveryId)
      results.push({ student_id: student.id, status: 'failed' })
    }
  }

  return json({ success: true, dry_run: Boolean(body.dry_run), checked: (students || []).length, results })
})

async function reminderRecipients(admin: any, student: any) {
  const recipients = new Set<string>()
  if (student.email) recipients.add(String(student.email).toLowerCase())

  const { data: links } = await admin.from('student_guardians')
    .select('guardian_id')
    .eq('student_id', student.id)
  const guardianIds = (links || []).map((link: any) => link.guardian_id)
  if (guardianIds.length) {
    const { data: parents } = await admin.from('parent_profiles')
      .select('email')
      .in('user_id', guardianIds)
      .eq('is_active', true)
    for (const parent of parents || []) if (parent.email) recipients.add(String(parent.email).toLowerCase())
  }

  if (student.instructor_id) {
    const { data } = await admin.auth.admin.getUserById(student.instructor_id)
    if (data.user?.email) recipients.add(data.user.email.toLowerCase())
  }
  recipients.add(ownerEmail)
  return [...recipients]
}

async function instructorName(admin: any, student: any) {
  if (student.instructor_id) {
    const { data } = await admin.from('staff_profiles')
      .select('full_name')
      .eq('user_id', student.instructor_id)
      .maybeSingle()
    if (data?.full_name) return data.full_name
  }
  return student.assigned_instructor_code === 'karen_st_pierre' ? 'Karen St. Pierre' :
    student.assigned_instructor_code === 'jason_st_louis' ? 'Jason St. Louis' : 'To be confirmed'
}

async function sendReminder(details: {
  recipients: string[]
  studentName: string
  instructorName: string
  language: string
  lessonAt: string
  duration: number
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('CONFIRMATION_FROM_EMAIL')
  if (!apiKey || !from) throw new Error('Email service is not configured')

  const french = details.language === 'fr'
  const when = formatToronto(details.lessonAt, french)
  const subject = french
    ? `Rappel de leçon demain — ${details.studentName}`
    : `Lesson reminder for tomorrow — ${details.studentName}`
  const html = french
    ? `<h1>Rappel de leçon</h1><p>La prochaine leçon de conduite de <strong>${escapeHtml(details.studentName)}</strong> aura lieu demain.</p><p><strong>Date et heure :</strong> ${escapeHtml(when)}</p><p><strong>Durée :</strong> ${details.duration} minutes</p><p><strong>Moniteur :</strong> ${escapeHtml(details.instructorName)}</p><p>Veuillez communiquer avec Summit Driver Academy au 613-804-7321 si vous avez des questions.</p>`
    : `<h1>Lesson reminder</h1><p><strong>${escapeHtml(details.studentName)}</strong> has a driving lesson tomorrow.</p><p><strong>Date and time:</strong> ${escapeHtml(when)}</p><p><strong>Duration:</strong> ${details.duration} minutes</p><p><strong>Instructor:</strong> ${escapeHtml(details.instructorName)}</p><p>Please contact Summit Driver Academy at 613-804-7321 if you have any questions.</p>`

  for (const recipient of details.recipients) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipient, subject, html }),
    })
    if (!response.ok) throw new Error(`Email delivery failed: ${response.status}`)
  }
}

function formatToronto(value: string, french: boolean) {
  return new Intl.DateTimeFormat(french ? 'fr-CA' : 'en-CA', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Toronto',
  }).format(new Date(value))
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]!))
}
