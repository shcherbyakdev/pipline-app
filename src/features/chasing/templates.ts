// Plain template literals, no email framework. Emails follow the portal's
// data discipline: program/unit/org names and dates only — never a person's
// name on a forwardable artifact. The participant's address is the envelope,
// not the content.
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SUBJECTS: readonly ((program: string) => string)[] = [
  (p) => `Your inspection link — ${p}`,
  (p) => `Reminder: ${p}`,
  (p) => `Reminder: ${p} is still waiting`,
  (p) => `Final reminder: ${p}`,
];

export function chaseEmail(input: {
  sendIndex: number;
  orgName: string;
  branding: { accentColor: string | null; logoUrl: string | null };
  programName: string;
  unitLine: string | null;
  url: string;
  stopUrl: string;
}): { subject: string; html: string; text: string } {
  const subjectFor = SUBJECTS[Math.min(input.sendIndex, SUBJECTS.length - 1)];
  const subject = subjectFor(input.programName);
  const accent = input.branding.accentColor ?? "#111827";
  const unitHtml = input.unitLine
    ? `<p style="margin:0 0 4px;color:#6b7280;font-size:14px;">${esc(input.unitLine)}</p>`
    : "";
  const logoHtml = input.branding.logoUrl
    ? `<img src="${esc(input.branding.logoUrl)}" alt="" height="28" style="display:block;margin-bottom:12px;" />`
    : "";
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
  ${logoHtml}
  <p style="margin:0 0 4px;font-weight:600;color:${esc(accent)};">${esc(input.orgName)}</p>
  <h1 style="margin:0 0 8px;font-size:18px;">${esc(subject)}</h1>
  ${unitHtml}
  <p style="margin:16px 0;font-size:14px;">There is outstanding work on <strong>${esc(input.programName)}</strong>. Open your link to complete it — no account needed.</p>
  <p style="margin:16px 0;"><a href="${esc(input.url)}" style="background:${esc(accent)};color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:14px;">Open my link</a></p>
  <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Done with this, or getting these in error? <a href="${esc(input.stopUrl)}" style="color:#9ca3af;">Stop reminding me</a>.</p>
</div>`;
  const text = [
    input.orgName,
    subject,
    ...(input.unitLine ? [input.unitLine] : []),
    "",
    `There is outstanding work on ${input.programName}. Open your link to complete it — no account needed.`,
    input.url,
    "",
    `Stop reminders: ${input.stopUrl}`,
  ].join("\n");
  return { subject, html, text };
}
