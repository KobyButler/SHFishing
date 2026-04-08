/**
 * Generates an iCalendar (.ics) file string for a booking event.
 *
 * @param {object} options
 * @param {string} options.summary - Event title
 * @param {string} options.description - Event description
 * @param {string} options.location - Event location
 * @param {string} options.date - ISO date string (YYYY-MM-DD)
 * @param {string} options.time - Start time (HH:MM)
 * @param {number} options.durationHours - Duration in hours
 * @param {string} options.organizerEmail - Organizer email
 * @param {string} options.organizerName - Organizer name
 * @param {string} [options.attendeeEmail] - Attendee email
 * @param {string} [options.attendeeName] - Attendee name
 * @param {string|number} options.uid - Unique event identifier
 * @returns {string} .ics file content
 */
const generateICS = ({
  summary,
  description,
  location,
  date,
  time,
  durationHours,
  organizerEmail,
  organizerName,
  attendeeEmail,
  attendeeName,
  uid
}) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  const pad = (n) => String(n).padStart(2, '0');

  const dtStart = `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(minute)}00`;

  const endDate = new Date(year, month - 1, day, hour + durationHours, minute);
  const dtEnd = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;

  const now = new Date();
  const dtStamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const escapedDescription = (description || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');

  const escapedSummary = (summary || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');

  const escapedLocation = (location || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//S&H Fishing//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:booking-${uid}@shfishing.com`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapedSummary}`,
    `DESCRIPTION:${escapedDescription}`,
    `LOCATION:${escapedLocation}`,
    `ORGANIZER;CN=${organizerName}:mailto:${organizerEmail}`
  ];

  if (attendeeEmail) {
    const cn = attendeeName || attendeeEmail;
    lines.push(`ATTENDEE;CN=${cn};RSVP=TRUE:mailto:${attendeeEmail}`);
  }

  lines.push(
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Fishing trip reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  );

  return lines.join('\r\n');
};

/**
 * Builds Google Calendar URL for adding an event.
 */
const googleCalendarUrl = ({ summary, description, location, date, time, durationHours }) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const pad = (n) => String(n).padStart(2, '0');

  const start = `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(minute)}00`;
  const endDate = new Date(year, month - 1, day, hour + durationHours, minute);
  const end = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: summary,
    dates: `${start}/${end}`,
    details: description || '',
    location: location || ''
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

/**
 * Builds Outlook.com calendar URL for adding an event.
 */
const outlookCalendarUrl = ({ summary, description, location, date, time, durationHours }) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  const startDt = new Date(year, month - 1, day, hour, minute);
  const endDt = new Date(year, month - 1, day, hour + durationHours, minute);

  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0];

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: summary,
    startdt: startDt.toISOString(),
    enddt: endDt.toISOString(),
    body: description || '',
    location: location || ''
  });

  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
};

export { generateICS, googleCalendarUrl, outlookCalendarUrl };
