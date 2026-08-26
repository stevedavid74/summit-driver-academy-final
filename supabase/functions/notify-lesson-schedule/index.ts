import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'

const allowedOrigins = new Set([
  'https://summitdriveracademy.com',
  'https://www.summitdriveracademy.com',
])

const ownerEmail = 'info@summitdriveracademy.com'

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || ''
  if (request.method === 'OPTIONS') return json({ ok: true }, 200, origin)
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)

  const authorization = request.headers.get('authorization')
  if (!authorization) return json({ error: 'Authentication required' }, 401, origin)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
  const serviceKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server configuration error' }, 500, origin)

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const { data: authData, error: authError } = await caller.auth.getUser()
  if (authError || !authData.user) return json({ error: 'Authentication required' }, 401, origin)

  const { data: operator } = await admin.from('staff_profiles')
    .select('user_id,role,is_active')
    .eq('user_id', authData.user.id)
    .in('role', ['owner', 'manager'])
    .eq('is_active', true)
    .maybeSingle()
  if (!operator) return json({ error: 'Manager or owner access required' }, 403, origin)

  let body: { student_id?: string; next_lesson_at?: string | null; scheduled_duration_minutes?: number }
  try { body = await request.json() } catch { return json({ error: 'Invalid request' }, 400, origin) }

  const studentId = String(body.student_id || '')
  const nextLessonAt = body.next_lesson_at === null ? null : String(body.next_lesson_at || '')
  const duration = Number(body.scheduled_duration_minutes || 120)
  if (!studentId || (nextLessonAt !== null && Number.isNaN(new Date(nextLessonAt).getTime())) || duration < 15 || duration > 480) {
    return json({ error: 'A valid student, lesson time, and duration are required' }, 400, origin)
  }

  const { data: previous, error: previousError } = await admin.from('students')
    .select('*')
    .eq('id', studentId)
    .maybeSingle()
  if (previousError || !previous) return json({ error: 'Student not found' }, 404, origin)

  const action = nextLessonAt === null ? 'cancelled' : previous.next_lesson_at ? 'rescheduled' : 'scheduled'
  const changes: Record<string, unknown> = { next_lesson_at: nextLessonAt }
  if (nextLessonAt !== null) changes.scheduled_duration_minutes = duration

  const { data: student, error: updateError } = await admin.from('students')
    .update(changes)
    .eq('id', studentId)
    .select('*')
    .single()
  if (updateError) return json({ success: false, error: updateError.message }, 200, origin)

  try {
    const recipients = new Set<string>()
    if (student.email) recipients.add(String(student.email).toLowerCase())

    const { data: links } = await admin.from('student_guardians')
      .select('guardian_id')
      .eq('student_id', student.id)
    const guardianIds = (links || []).map((link) => link.guardian_id)
    if (guardianIds.length) {
      const { data: parents } = await admin.from('parent_profiles').select('email').in('user_id', guardianIds)
      for (const parent of parents || []) if (parent.email) recipients.add(String(parent.email).toLowerCase())
    }

    if (student.instructor_id) {
      const { data: instructorData } = await admin.auth.admin.getUserById(student.instructor_id)
      if (instructorData.user?.email) recipients.add(instructorData.user.email.toLowerCase())
    }
    recipients.add(ownerEmail)

    const notificationSent = await sendNotifications({
      recipients: [...recipients],
      action,
      studentName: student.full_name,
      instructorName: await instructorName(admin, student),
      language: student.preferred_language,
      previousLessonAt: previous.next_lesson_at,
      nextLessonAt: student.next_lesson_at,
      duration: student.scheduled_duration_minutes || duration,
    })

    return json({ success: true, student, notification_sent: notificationSent, recipient_count: recipients.size }, 200, origin)
  } catch (error) {
    console.error(error)
    return json({ success: true, student, notification_sent: false }, 200, origin)
  }
})

async function instructorName(admin: any, student: any) {
  if (student.instructor_id) {
    const { data } = await admin.from('staff_profiles').select('full_name').eq('user_id', student.instructor_id).maybeSingle()
    if (data?.full_name) return data.full_name
  }
  return student.assigned_instructor_code === 'karen_st_pierre' ? 'Karen St. Pierre' :
    student.assigned_instructor_code === 'jason_st_louis' ? 'Jason St. Louis' : 'To be confirmed'
}

async function sendNotifications(details: {
  recipients: string[]
  action: string
  studentName: string
  instructorName: string
  language: string
  previousLessonAt: string | null
  nextLessonAt: string | null
  duration: number
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('CONFIRMATION_FROM_EMAIL')
  if (!apiKey || !from) return false

  const french = details.language === 'fr'
  const labels = french
    ? { scheduled: 'Leçon planifiée', rescheduled: 'Leçon replanifiée', cancelled: 'Leçon annulée' }
    : { scheduled: 'Lesson scheduled', rescheduled: 'Lesson rescheduled', cancelled: 'Lesson cancelled' }
  const subject = `${labels[details.action as keyof typeof labels]} — ${details.studentName}`
  const shownTime = details.action === 'cancelled' ? details.previousLessonAt : details.nextLessonAt
  const scheduleText = formatToronto(shownTime, french)
  const previousText = details.action === 'rescheduled' ? formatToronto(details.previousLessonAt, french) : ''

  const html = french
    ? `<h1>${labels[details.action as keyof typeof labels]}</h1><p><strong>Élève :</strong> ${escapeHtml(details.studentName)}</p><p><strong>Moniteur :</strong> ${escapeHtml(details.instructorName)}</p>${previousText ? `<p><strong>Ancienne heure :</strong> ${escapeHtml(previousText)}</p>` : ''}<p><strong>${details.action === 'cancelled' ? 'Leçon annulée' : 'Nouvelle heure'} :</strong> ${escapeHtml(scheduleText)}</p><p><strong>Durée :</strong> ${details.duration} minutes</p><p>Veuillez communiquer avec Summit Driver Academy si vous avez des questions.</p>`
    : `<h1>${labels[details.action as keyof typeof labels]}</h1><p><strong>Student:</strong> ${escapeHtml(details.studentName)}</p><p><strong>Instructor:</strong> ${escapeHtml(details.instructorName)}</p>${previousText ? `<p><strong>Previous time:</strong> ${escapeHtml(previousText)}</p>` : ''}<p><strong>${details.action === 'cancelled' ? 'Cancelled lesson' : 'New time'}:</strong> ${escapeHtml(scheduleText)}</p><p><strong>Duration:</strong> ${details.duration} minutes</p><p>Please contact Summit Driver Academy if you have any questions.</p>`

  for (const recipient of details.recipients) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipient, subject, html }),
    })
    if (!response.ok) throw new Error(`Email delivery failed: ${response.status}`)
  }
  return true
}

function formatToronto(value: string | null, french: boolean) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(french ? 'fr-CA' : 'en-CA', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Toronto',
  }).format(new Date(value))
}

function json(payload: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': allowedOrigins.has(origin) ? origin : 'https://summitdriveracademy.com',
      'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
      'vary': 'origin',
    },
  })
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]!))
}
