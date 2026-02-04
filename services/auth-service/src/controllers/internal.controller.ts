import { Request, Response } from "express";
import { renderEmailEjs } from "../helper.js";
import { emailQueue, emailQueueName } from "../jobs/EmailJob.js";

export const sendBridgeInviteEmail = async (req: Request, res: Response) => {
  try {
    const { to, channelName, inviterName, url } = req.body;
    if (!to || !channelName || !inviterName || !url) {
      return res.status(400).json({
        message: "Missing required fields: to, channelName, inviterName, url",
      });
    }

    const emailBody = await renderEmailEjs("bridge-invite", {
      inviteeName: to.split("@")[0] || "there",
      channelName,
      inviterName,
      url,
    });

    await emailQueue.add(emailQueueName, {
      to,
      subject: `Jibbr | You're invited to Bridge Channel: ${channelName}`,
      body: emailBody,
    });

    return res.status(200).json({ message: "Email queued successfully" });
  } catch (error) {
    console.error("Error sending bridge invite email:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
