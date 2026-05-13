import type { ResumeJSON } from '@/types'

function printWindow(html: string) {
  const win = window.open('', '_blank')
  if (!win) { alert('Allow popups to download as PDF.'); return }
  win.document.write(html)
  win.document.close()
  win.focus()
  // Small delay so fonts/styles load before print dialog
  setTimeout(() => { win.print() }, 400)
}

const BASE_STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Georgia', serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #1a1a1a;
    background: #fff;
    padding: 0.9in 1in;
    max-width: 8.5in;
  }
  @media print {
    body { padding: 0; }
    @page { margin: 0.9in 1in; size: letter; }
  }
`

export function downloadCoverLetterPdf(
  text: string,
  jobTitle?: string | null,
  company?: string | null,
  authorName?: string | null,
) {
  const label = [jobTitle, company].filter(Boolean).join(' · ')
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${authorName ? `${authorName} — ` : ''}Cover Letter${label ? ` · ${label}` : ''}</title>
<style>
${BASE_STYLES}
p { margin-bottom: 1em; }
</style>
</head>
<body>
${paragraphs}
</body>
</html>`

  printWindow(html)
}

export function downloadResumePdf(
  resume: ResumeJSON,
  name?: string | null,
  jobTitle?: string | null,
  company?: string | null,
) {
  const label = [jobTitle, company].filter(Boolean).join(' at ')

  const summaryHtml = resume.summary
    ? `<section><h2>Summary</h2><p>${resume.summary}</p></section>`
    : ''

  const experienceHtml = resume.experience?.length
    ? `<section>
        <h2>Experience</h2>
        ${resume.experience.map(e => `
          <div class="exp-block">
            <div class="exp-header">
              <span class="exp-title">${e.title}</span>
              <span class="exp-dates">${e.start_date} – ${e.end_date ?? 'Present'}</span>
            </div>
            <div class="exp-company">${e.company}${e.location ? ` · ${e.location}` : ''}</div>
            <ul>${e.bullets.map(b => `<li>${b}</li>`).join('')}</ul>
          </div>
        `).join('')}
      </section>`
    : ''

  const skillsHtml = resume.skills?.length
    ? `<section><h2>Skills</h2><p class="skills">${resume.skills.join(' · ')}</p></section>`
    : ''

  const educationHtml = resume.education?.length
    ? `<section>
        <h2>Education</h2>
        ${resume.education.map(e => `
          <div class="edu-block">
            <span class="edu-degree">${e.degree}${e.field ? ` in ${e.field}` : ''}</span>
            <span class="edu-school">${e.institution}${e.graduation_year ? ` · ${e.graduation_year}` : ''}</span>
          </div>
        `).join('')}
      </section>`
    : ''

  const certsHtml = resume.certifications?.length
    ? `<section>
        <h2>Certifications</h2>
        <ul>${resume.certifications.map(c => `<li>${c}</li>`).join('')}</ul>
      </section>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${name ? `${name} — ` : ''}Resume${label ? ` · ${label}` : ''}</title>
<style>
${BASE_STYLES}
h1 { font-size: 22pt; font-weight: bold; letter-spacing: -0.5px; margin-bottom: 2pt; }
.subtitle { font-size: 10pt; color: #555; margin-bottom: 20pt; }
section { margin-bottom: 18pt; }
h2 {
  font-size: 9pt; font-weight: bold; text-transform: uppercase;
  letter-spacing: 1px; color: #555; border-bottom: 0.75pt solid #ccc;
  padding-bottom: 3pt; margin-bottom: 10pt;
  font-family: 'Arial', sans-serif;
}
p { margin-bottom: 6pt; font-size: 11pt; }
.exp-block { margin-bottom: 12pt; }
.exp-header { display: flex; justify-content: space-between; align-items: baseline; }
.exp-title { font-weight: bold; font-size: 11pt; }
.exp-dates { font-size: 10pt; color: #555; }
.exp-company { font-size: 10pt; color: #444; margin-bottom: 4pt; }
ul { padding-left: 16pt; margin-bottom: 0; }
li { font-size: 10.5pt; line-height: 1.55; margin-bottom: 2pt; }
.skills { font-size: 10.5pt; color: #222; line-height: 1.7; }
.edu-block { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6pt; }
.edu-degree { font-weight: bold; font-size: 11pt; }
.edu-school { font-size: 10pt; color: #555; }
</style>
</head>
<body>
${name ? `<h1>${name}</h1>` : ''}
${label ? `<p class="subtitle">Tailored for: ${label}</p>` : ''}
${summaryHtml}
${experienceHtml}
${skillsHtml}
${educationHtml}
${certsHtml}
</body>
</html>`

  printWindow(html)
}
