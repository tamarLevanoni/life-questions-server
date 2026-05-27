import { Resend } from 'resend';
import { ContactInput } from '../modules/contact/contact.validators';

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const categoryLabel: Record<string, string> = {
  general:        'פנייה כללית',
  bug:            'תקלה',
  collaboration:  'שיתוף פעולה',
  story_question: 'שאלה על סיפור',
};

function storySection(data: ContactInput): string {
  if (data.category !== 'story_question' || !data.story) return '';

  const row = (label: string, value?: string) =>
    value ? `<tr><td style="color:#666;padding:4px 8px;white-space:nowrap;width:1%"><strong>${label}</strong></td><td style="padding:4px 8px;white-space:pre-wrap">${value}</td></tr>` : '';

  return `
    <tr><td colspan="2" style="padding:12px 8px 4px;font-weight:bold;border-top:2px solid #ddd">פרטי הסיפור (ID: ${data.story.id})</td></tr>
    ${row('כותרת', data.story.title)}
    ${row('סיפור', data.story.storyBody)}
    ${row('שאלה',  data.story.legalQuestion)}
    ${row('תשובה', data.story.shortAnswer)}
    ${row('הרחבה', data.story.expansion)}
    <tr><td colspan="2" style="padding:12px 8px 4px;font-weight:bold;border-top:2px solid #ddd">שאלת המשתמש</td></tr>
  `;
}

export async function sendContactEmail(data: ContactInput): Promise<void> {
  const to = process.env.CONTACT_EMAIL_TO;
  if (!to) throw new Error('CONTACT_EMAIL_TO is not set');

  const pageUrlRow = data.pageUrl
    ? `<tr><td style="white-space:nowrap;width:1%;padding:4px 8px"><strong>Page URL</strong></td><td style="padding:4px 8px">${data.pageUrl}</td></tr>`
    : '';

  await getResend().emails.send({
    from:    'contact@th-lod.org',
    to,
    replyTo: data.email,
    subject: `[${categoryLabel[data.category]}] ${data.subject}`,
    html: `
      <div dir="rtl" style="font-family:sans-serif;font-size:14px;direction:rtl;text-align:right">
      <table cellpadding="8" style="width:100%;table-layout:auto">
        <tr><td style="white-space:nowrap;width:1%;padding:4px 8px"><strong>שם</strong></td><td style="padding:4px 8px">${data.name}</td></tr>
        <tr><td style="white-space:nowrap;width:1%;padding:4px 8px"><strong>אימייל</strong></td><td style="padding:4px 8px">${data.email}</td></tr>
        <tr><td style="white-space:nowrap;width:1%;padding:4px 8px"><strong>קטגוריה</strong></td><td>${categoryLabel[data.category]}</td></tr>
        <tr><td style="white-space:nowrap;width:1%;padding:4px 8px"><strong>נושא</strong></td><td style="padding:4px 8px">${data.subject}</td></tr>
        ${pageUrlRow}
        ${storySection(data)}
        <tr><td style="white-space:nowrap;width:1%;padding:4px 8px"><strong>הודעה</strong></td><td style="white-space:pre-wrap">${data.message}</td></tr>
      </table>
      </div>
    `,
  });
}
