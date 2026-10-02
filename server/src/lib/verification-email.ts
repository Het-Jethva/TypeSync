import { config } from "../config.js";

export async function sendVerificationEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}): Promise<void> {
  if (!config.resendApiKey || !config.emailFrom) {
    throw new Error("Email verification requires RESEND_API_KEY and EMAIL_FROM");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [email],
      subject: "Verify your TypeSync email",
      text: `Verify your email to sign in and receive shared documents:\n\n${url}\n\nThis link expires in one hour. If you did not create a TypeSync account, ignore this email.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Verification email delivery failed (HTTP ${response.status})`);
  }
}
