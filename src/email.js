import nodemailer from 'nodemailer';

const createTransporter = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === 'true',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
};

const sendMail = async ({ to, subject, text, html, attachments }) => {
  const transporter = createTransporter();
  if (!transporter) {
    console.log('[email] Missing SMTP config. Email skipped:', { to, subject });
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || 'S&H Fishing <no-reply@shfishing.com>',
      to,
      subject,
      text,
      html,
      attachments
    });
  } catch (error) {
    console.log('[email] Send failed. Check SMTP settings.', error?.message || error);
  }
};

export { sendMail };
