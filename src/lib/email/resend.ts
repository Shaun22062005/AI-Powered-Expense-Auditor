import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY!;
const resendFromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

export const resend = new Resend(resendApiKey);

interface NotificationPayload {
  to: string;
  employeeName: string;
  merchant: string;
  amount: number;
  currency: string;
  status: "approved" | "flagged" | "rejected";
  reason: string;
}

/**
 * Sends an automated email notification regarding an expense audit verdict.
 * Throws a descriptive error if the send operation fails.
 */
export async function sendAuditNotification({
  to,
  employeeName,
  merchant,
  amount,
  currency,
  status,
  reason
}: NotificationPayload) {
  const subject = `Your expense claim for ${merchant} has been ${status}`;
  
  const statusColor = {
    approved: "#10B981", // green-500
    flagged: "#F59E0B", // amber-500
    rejected: "#EF4444" // red-500
  }[status];

  const { data, error } = await resend.emails.send({
    from: `Cymonic Audit <${resendFromEmail}>`,
    to,
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; color: #111827;">
        <h2 style="color: #111827; margin-bottom: 24px;">Expense Audit Verdict</h2>
        <p>Hi ${employeeName},</p>
        <p>Your expense claim for <strong>${merchant}</strong> has been <strong>${status}</strong>.</p>
        
        <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 24px 0; border: 1px solid #f3f4f6;">
          <p style="margin: 0 0 12px 0; font-size: 16px;"><strong>Amount:</strong> ${amount} ${currency}</p>
          <p style="margin: 0; font-size: 16px;">
            <strong>Status:</strong> 
            <span style="color: ${statusColor}; font-weight: 700; text-transform: uppercase;">${status}</span>
          </p>
        </div>

        <div style="margin-top: 24px; padding: 16px; border-left: 4px solid ${statusColor}; background-color: #ffffff;">
          <h3 style="font-size: 14px; color: #6b7280; margin: 0 0 8px 0; text-transform: uppercase;">Reason</h3>
          <p style="color: #374151; margin: 0; line-height: 1.5;">${reason}</p>
        </div>

        <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
          <p style="font-size: 12px; color: #9ca3af; margin: 0;">
            This is an automated notification from the Cymonic Expense Auditor.
          </p>
        </div>
      </div>
    `
  });

  if (error) {
    throw new Error(`Failed to send audit notification email: ${error.message}`);
  }

  return data;
}
