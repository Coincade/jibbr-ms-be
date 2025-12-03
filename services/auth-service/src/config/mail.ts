import nodemailer from "nodemailer";
import type { Options as SMTPTransportOptions } from "nodemailer/lib/smtp-transport";

const createTransporter = () => {
  console.log("Creating transporter with:", {
    user: process.env.SMTP_USER,
    pass_exists: !!process.env.SMTP_PASSWORD,
  });

  return nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  } satisfies SMTPTransportOptions);
};

const sendEmail = async (to: string, subject: string, body: string) => {
  try {
    const transporter = createTransporter();
    console.log("Attempting to send email");
    const info = await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: to,
      subject: subject,
      html: body,
    });
    console.log("Email sent!");

    return info;
  } catch (error: any) {
    console.error("Error sending email:", {
      error,
      errorMessage: error.message,
      errorCode: error.code,
      errorResponse: error.response,
    });
    throw error;
  }
};

const mailHelper = async (to: string, subject: string, body: string) => {
  const transporter = nodemailer.createTransport({
    host: process.env.GMAIL_HOST,
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  } satisfies SMTPTransportOptions);

  try {
    console.log("Attempting to send email");
    const info = await transporter.sendMail({
      from: "connect@coincade.io",
      to: to,
      subject: subject,
      html: body,
    });
    console.log("Email sent!");
  } catch (error: any) {
    console.error("Error sending email:", {
      error,
      errorMessage: error.message,
      errorCode: error.code,
      errorResponse: error.response,
    });
    throw error;
  }
};

export { sendEmail, mailHelper };
