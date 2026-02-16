import { Request, Response } from "express";
import { forgetPasswordSchema, forgetResetPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from "../validation/auth.validations.js";
import { ZodError } from "zod";
import { checkDateHourDiff, formatError, renderEmailEjs } from "../helper.js";
import prisma from "../config/database.js";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { emailQueue, emailQueueName } from "../jobs/EmailJob.js";
import jwt from "jsonwebtoken";

export const register = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const payload = registerSchema.parse(body);
    let user = await prisma.user.findUnique({
      where: { email: payload.email },
    });

    if (user) {
      return res
        .status(422)
        .json({ errors: { email: "Email already exists" } });
    }

    // Encrypt password
    const salt = await bcrypt.genSalt(10);
    payload.password = await bcrypt.hash(payload.password, salt);

    const token = await bcrypt.hash(uuidv4(), salt);
    // Send verification link to website, which will handle the API call
    const url = `${process.env.CLIENT_APP_URL}/verify-email?email=${encodeURIComponent(payload.email)}&token=${encodeURIComponent(token)}`;
    const emailBody = await renderEmailEjs("email-verify", {
      name: payload.name,
      url,
    });

    //Send Email (non-blocking - if this fails, user is still created)
    try {
      await emailQueue.add(emailQueueName, {
        to: payload.email,
        subject: "Jibbr | Verify your email",
        body: emailBody,
      });
    } catch (emailError) {
      // Log email error but continue with user creation
      console.error("Failed to queue verification email:", emailError);
    }

    await prisma.user.create({
      data: {
        name: payload.name,
        email: payload.email,
        password: payload.password,
        email_verify_token: token,
        email_verify_token_sent_at: new Date(),
      },
    });

    return res
      .status(201)
      .json({ message: "Please check your email to verify your account" });
  } catch (error) {
    console.error("Error in register controller:", error);
    
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    
    // Log the actual error for debugging
    if (error instanceof Error) {
      console.error("Register error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    
    return res.status(500).json({ 
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? (error instanceof Error ? error.message : "Unknown error") : undefined
    });
  }
};
export const login = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const payload = loginSchema.parse(body);
    let user = await prisma.user.findUnique({
      where: { email: payload.email },
    });

    if (!user || user === null) {
      return res.status(422).json({
        errors: {
          email: "No user found with this email",
        },
      });
    }

    //Compare Password
    const isPasswordValid = await bcrypt.compare(
      payload.password,
      user.password
    );
    if (!isPasswordValid) {
      return res.status(422).json({
        errors: {
          email: "Invalid email or password",
        },
      });
    }

    // Block login if email is not verified
    if (!user.email_verified_at) {
      return res.status(403).json({
        message: "Please verify your email",
        errors: {
          email: "Please verify your email to sign in.",
        },
      });
    }

    //JWT Payload
    const JWTPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
    };

    //Generate JWT Token
    let token = jwt.sign(JWTPayload, process.env.JWT_SECRET as string, {
      expiresIn: "30d",
    })

    return res.status(200).json({
      message: "Logged in successfully",
      data: {
        ...JWTPayload,
        token: `Bearer ${token}`,
        emailVerified: !!user.email_verified_at,
        emailVerifiedAt: user.email_verified_at,
        hasVerificationToken: !!user.email_verify_token,
      },
    });
  } catch (error) {
    console.error("Error in login controller:", error);
    
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    
    // Log the actual error for debugging
    if (error instanceof Error) {
      console.error("Login error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    
    return res.status(500).json({ 
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? (error instanceof Error ? error.message : "Unknown error") : undefined
    });
  }
};
export const logout = async (req: Request, res: Response) => {
  res.send("Logged out successfully!");
};

export const verifyEmail = async (req: Request, res: Response) => {
  try {
    const { email, token } = req.query;
    
    if (!email || !token) {
      const isApiRequest = req.headers.accept?.includes('application/json') || req.query.format === 'json';
      if (!email) {
        if (isApiRequest) {
          return res.status(400).json({ 
            message: "Email is required",
            errors: { email: "Email is required" }
          });
        }
        return res.redirect("/verify-error");
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: email as string },
      });
      if (existingUser?.email_verified_at) {
        if (isApiRequest) {
          return res.status(200).json({
            message: "Email already verified",
            data: { email: email as string, verified: true, alreadyVerified: true }
          });
        }
        return res.redirect(`${process.env.CLIENT_APP_URL}/verify-email?already_verified=1&email=${encodeURIComponent(String(email))}`);
      }

      if (isApiRequest) {
        return res.status(400).json({ 
          message: "Email and token are required",
          errors: { email: "Email and token are required" }
        });
      }
      return res.redirect("/verify-error");
    }

    const user = await prisma.user.findUnique({
      where: { email: email as string },
    });

    if (!user) {
      const isApiRequest = req.headers.accept?.includes('application/json') || req.query.format === 'json';
      if (isApiRequest) {
        return res.status(404).json({ 
          message: "User not found",
          errors: { email: "User not found with this email" }
        });
      }
      return res.redirect("/verify-error");
    }

    if (user.email_verified_at) {
      const isApiRequest = req.headers.accept?.includes('application/json') || req.query.format === 'json';
      if (isApiRequest) {
        return res.status(200).json({ 
          message: "Email already verified",
          data: { email: email as string, verified: true, alreadyVerified: true }
        });
      }
      return res.redirect(`${process.env.CLIENT_APP_URL}/verify-email?already_verified=1&email=${encodeURIComponent(String(email))}`);
    }

    if (token !== user.email_verify_token) {
      const isApiRequest = req.headers.accept?.includes('application/json') || req.query.format === 'json';
      if (isApiRequest) {
        return res.status(422).json({ 
          message: "Invalid verification token",
          errors: { token: "Invalid or expired verification token" }
        });
      }
      return res.redirect("/verify-error");
    }

    // Check if verification link has expired (2 hours)
    if (user.email_verify_token_sent_at) {
      const hoursSinceSent = checkDateHourDiff(user.email_verify_token_sent_at);
      if (hoursSinceSent > 2) {
        const isApiRequest = req.headers.accept?.includes('application/json') || req.query.format === 'json';
        if (isApiRequest) {
          return res.status(422).json({ 
            message: "Verification link expired",
            errors: { token: "This verification link has expired. Please request a new one." }
          });
        }
        return res.redirect(`${process.env.CLIENT_APP_URL}/verify-email?error=expired&email=${encodeURIComponent(String(email))}`);
      }
    }

    // Token is valid, verify the email
    await prisma.user.update({
      data: {
        email_verify_token: null,
        email_verified_at: new Date().toISOString(),
      },
      where: { email: email as string },
    });

    // Check if this is an API request
    const isApiRequest = req.headers.accept?.includes('application/json') || req.query.format === 'json';
    if (isApiRequest) {
      return res.status(200).json({ 
        message: "Email verified successfully",
        data: { email: email as string, verified: true }
      });
    }

    // Otherwise redirect to client app success page
    return res.redirect(`${process.env.CLIENT_APP_URL}/verify-email?email=${encodeURIComponent(String(email))}&verified=1`);
  } catch (error) {
    console.error("Error in verifyEmail:", error);
    const isApiRequest = req.headers.accept?.includes('application/json') || req.query.format === 'json';
    if (isApiRequest) {
      return res.status(500).json({ 
        message: "Internal server error",
        error: process.env.NODE_ENV === "development" ? (error instanceof Error ? error.message : "Unknown error") : undefined
      });
    }
    return res.redirect("/verify-error");
  }
};

export const resendVerificationEmail = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(422).json({ message: "Email is required", errors: { email: "Email is required" } });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(422).json({ message: "User not found", errors: { email: "User not found with this email" } });
    }

    if (user.email_verified_at) {
      return res.status(422).json({ message: "Email already verified", errors: { email: "Email is already verified" } });
    }

    // Generate new verification token
    const salt = await bcrypt.genSalt(10);
    const token = await bcrypt.hash(uuidv4(), salt);
    // Send verification link to website, which will handle the API call
    const url = `${process.env.CLIENT_APP_URL}/verify-email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
    
    // Update user with new token and sent-at timestamp
    await prisma.user.update({
      data: {
        email_verify_token: token,
        email_verify_token_sent_at: new Date(),
      },
      where: { email },
    });

    // Send Email (non-blocking)
    try {
      const emailBody = await renderEmailEjs("email-verify", {
        name: user.name,
        url,
      });

      await emailQueue.add(emailQueueName, {
        to: email,
        subject: "Jibbr | Verify your email",
        body: emailBody,
      });
    } catch (emailError) {
      console.error("Failed to queue verification email:", emailError);
      // Token is still updated, user can request again if needed
    }

    return res.status(200).json({ message: "Verification email sent" });
  } catch (error) {
    console.error("Error in resendVerificationEmail:", error);
    
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    
    return res.status(500).json({ 
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? (error instanceof Error ? error.message : "Unknown error") : undefined
    });
  }
};

export const verifyError = async (req: Request, res: Response) => {
  res.render("auth/emailVerifyError");
};

export const getUser = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(422).json({message: "User Not Found"});
  }
  res.status(200).json({data: user});
}

export const forgetPassword = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const payload = forgetPasswordSchema.parse(body);

    const user = await prisma.user.findUnique({where: { email: payload.email }})

    if(!user || user === null) {
      return res.status(422).json({message: "User not found", errors: {email: "User not found with this email"}})
    }

    // Rate limit: require 2 hours between password reset requests
    if (user.token_send_at) {
      const hoursSinceLastRequest = checkDateHourDiff(user.token_send_at);
      if (hoursSinceLastRequest < 2) {
        return res.status(429).json({
          message: "Please wait 2 hours before requesting another password reset link",
          errors: { email: "A reset link was recently sent. Please wait 2 hours before requesting another." },
          retryAfterHours: Math.ceil(2 - hoursSinceLastRequest),
        });
      }
    }

   const salt = await bcrypt.genSalt(10);
   const token = await bcrypt.hash(uuidv4(), salt);
   await prisma.user.update({
    data:{
      password_reset_token: token,
      token_send_at: new Date().toISOString()
    },
    where:{ email: payload.email}
   })
   // Send password reset link to website, which will handle the reset flow
   const url = `${process.env.CLIENT_APP_URL}/forget-reset-password?email=${encodeURIComponent(payload.email)}&token=${encodeURIComponent(token)}`;

   const html = await renderEmailEjs("forget-password", {
    url,
   });

   // Send Email (non-blocking - if this fails, token is still saved)
   try {
     await emailQueue.add(emailQueueName, {
      to: payload.email,
      subject: "Jibbr | Reset Password",
      body: html,
     });
   } catch (emailError) {
     // Log email error but don't fail the request
     console.error("Failed to queue password reset email:", emailError);
     console.error("Password reset token saved but email not sent. Email:", payload.email);
   }

   return res.status(200).json({message: "Password reset email sent"})
  } catch (error) {
    console.error("Error in forgetPassword controller:", error);
    
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    
    // Log the actual error for debugging
    if (error instanceof Error) {
      console.error("ForgetPassword error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    
    return res.status(500).json({ 
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? (error instanceof Error ? error.message : "Unknown error") : undefined
    });
  }
};

export const forgetResetPassword = async (req: Request, res: Response) => {
  try{
    const body = req.body;
    const payload = forgetResetPasswordSchema.parse(body);

    const user = await prisma.user.findUnique({where: { email: payload.email }})

    if(!user || user === null) {
      return res.status(422).json({message: "User not found", errors: {email: "User not found with this email"}})
    }

    //Check token
    if(user.password_reset_token !== payload.token) {
      return res.status(422).json({message: "User not found", errors: {email: "Token is invalid"}})
    }

    //Check token expiration for 2 hrs time frame
    const hoursDiff = checkDateHourDiff(user.token_send_at!);
    if(hoursDiff > 2) {
      return res.status(422).json({message: "Token expired", errors: {email: "Token expired"}})
    }

    //Update password
    const salt = await bcrypt.genSalt(10);
    const newPass = await bcrypt.hash(payload.password, salt); 

    await prisma.user.update({
      data: {
        password: newPass,
        password_reset_token: null,
        token_send_at: null,
      },
      where: { email: payload.email },
    });

    return res.status(200).json({message: "Password reset successfully"})
    
    
  } catch (error) {
    console.error("Error in forgetResetPassword controller:", error);
    
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    
    // Log the actual error for debugging
    if (error instanceof Error) {
      console.error("ForgetResetPassword error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    
    return res.status(500).json({ 
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? (error instanceof Error ? error.message : "Unknown error") : undefined
    });
  }
}

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const payload = resetPasswordSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { email: payload.email } });

    if (!user || user === null) {
      return res.status(422).json({ message: "User not found", errors: { email: "User not found with this email" } });
    }

    // Check if user knows their current password
    const isCurrentPasswordValid = await bcrypt.compare(payload.currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(422).json({ message: "Current password is incorrect", errors: { currentPassword: "Current password is incorrect" } });
    }

    // Double-check that new password and confirm password match (extra safety)
    if (payload.password !== payload.confirmPassword) {
      return res.status(422).json({ message: "Passwords do not match", errors: { confirmPassword: "New password and confirm password do not match" } });
    }

    // Prevent using the same password as current
    const isSamePassword = await bcrypt.compare(payload.password, user.password);
    if (isSamePassword) {
      return res.status(422).json({ message: "New password must be different from current password", errors: { password: "New password must be different from current password" } });
    }

    // Update password
    const salt = await bcrypt.genSalt(10);
    const newPass = await bcrypt.hash(payload.password, salt);

    await prisma.user.update({
      data: {
        password: newPass,
      },
      where: { email: payload.email },
    });

    return res.status(200).json({ message: "Password changed successfully" });

  } catch (error) {
    console.error("Error in resetPassword controller:", error);
    
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    
    // Log the actual error for debugging
    if (error instanceof Error) {
      console.error("ResetPassword error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    
    return res.status(500).json({ 
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? (error instanceof Error ? error.message : "Unknown error") : undefined
    });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const userIdToDelete = req.params.id;
    const deletePass = req.body.DELETE_PASS;

    // Check if DELETE_PASS is provided and matches environment variable
    if (!deletePass || deletePass !== process.env.DELETE_PASS) {
      return res.status(403).json({ message: "Invalid delete password" });
    }

    // Check if user to delete exists
    const userToDelete = await prisma.user.findUnique({
      where: { id: userIdToDelete },
    });

    if (!userToDelete) {
      return res.status(404).json({ message: "User not found" });
    }

    // Prevent user from deleting themselves
    if (user.id === userIdToDelete) {
      return res.status(400).json({ message: "You cannot delete yourself" });
    }

    // Delete all related data in the correct order to avoid foreign key constraints
    
    // 1. Delete all reactions by this user
    await prisma.reaction.deleteMany({
      where: { userId: userIdToDelete }
    });

    // 2. Delete all forwarded messages by this user
    await prisma.forwardedMessage.deleteMany({
      where: { forwardedByUserId: userIdToDelete }
    });

    // 3. Delete all attachments in messages by this user
    await prisma.attachment.deleteMany({
      where: {
        message: {
          userId: userIdToDelete
        }
      }
    });

    // 4. Delete all messages by this user
    await prisma.message.deleteMany({
      where: { userId: userIdToDelete }
    });

    // 5. Delete all channel memberships
    await prisma.channelMember.deleteMany({
      where: { userId: userIdToDelete }
    });

    // 5b. Delete all channel invites created by this user (inviter)
    await prisma.channelInvite.deleteMany({
      where: { inviterId: userIdToDelete }
    });

    // 6. Handle channels where user is admin - transfer admin to workspace creator or delete channel
    const channelsWhereUserIsAdmin = await prisma.channel.findMany({
      where: { channelAdminId: userIdToDelete },
      include: { workspace: true }
    });

    for (const channel of channelsWhereUserIsAdmin) {
      // Try to transfer admin to workspace creator
      const workspaceCreator = await prisma.user.findUnique({
        where: { id: channel.workspace.userId }
      });

      if (workspaceCreator) {
        // Transfer admin to workspace creator
        await prisma.channel.update({
          where: { id: channel.id },
          data: { channelAdminId: workspaceCreator.id }
        });
      } else {
        // If workspace creator doesn't exist, delete the channel
        await prisma.channel.delete({
          where: { id: channel.id }
        });
      }
    }

    // 7. Delete all workspace memberships
    await prisma.member.deleteMany({
      where: { userId: userIdToDelete }
    });

    // 8. Delete all conversation participations
    await prisma.conversationParticipant.deleteMany({
      where: { userId: userIdToDelete }
    });

    // 9. Delete all conversation read statuses
    await prisma.conversationReadStatus.deleteMany({
      where: { userId: userIdToDelete }
    });

    // 10. Delete all user notifications
    await prisma.userNotification.deleteMany({
      where: { userId: userIdToDelete }
    });

    // 11. Delete all notification preferences
    await prisma.userNotificationPreference.deleteMany({
      where: { userId: userIdToDelete }
    });

    // 12. Handle workspaces created by this user
    // First, get all workspaces created by this user
    const userWorkspaces = await prisma.workspace.findMany({
      where: { userId: userIdToDelete }
    });

    // For each workspace, delete all related data
    for (const workspace of userWorkspaces) {
      // Delete reactions in workspace channels
      await prisma.reaction.deleteMany({
        where: {
          message: {
            channel: {
              workspaceId: workspace.id
            }
          }
        }
      });

      // Delete attachments in workspace channels
      await prisma.attachment.deleteMany({
        where: {
          message: {
            channel: {
              workspaceId: workspace.id
            }
          }
        }
      });

      // Delete forwarded messages in workspace channels
      await prisma.forwardedMessage.deleteMany({
        where: {
          channel: {
            workspaceId: workspace.id
          }
        }
      });

      // Delete messages in workspace channels
      await prisma.message.deleteMany({
        where: {
          channel: {
            workspaceId: workspace.id
          }
        }
      });

      // Delete channel members
      await prisma.channelMember.deleteMany({
        where: {
          channel: {
            workspaceId: workspace.id
          }
        }
      });

      // Delete channels
      await prisma.channel.deleteMany({
        where: { workspaceId: workspace.id }
      });

      // Delete conversation-related data (Conversation has workspaceId FK)
      await prisma.reaction.deleteMany({
        where: {
          message: {
            conversation: { workspaceId: workspace.id }
          }
        }
      });
      await prisma.attachment.deleteMany({
        where: {
          message: {
            conversation: { workspaceId: workspace.id }
          }
        }
      });
      await prisma.forwardedMessage.deleteMany({
        where: { conversation: { workspaceId: workspace.id } }
      });
      await prisma.message.deleteMany({
        where: { conversation: { workspaceId: workspace.id } }
      });
      await prisma.conversationReadStatus.deleteMany({
        where: { conversation: { workspaceId: workspace.id } }
      });
      await prisma.conversationParticipant.deleteMany({
        where: { conversation: { workspaceId: workspace.id } }
      });
      await prisma.conversation.deleteMany({
        where: { workspaceId: workspace.id }
      });

      // Delete workspace members
      await prisma.member.deleteMany({
        where: { workspaceId: workspace.id }
      });

      // Delete the workspace
      await prisma.workspace.delete({
        where: { id: workspace.id }
      });
    }

    // 13. Finally, delete the user
    await prisma.user.delete({
      where: { id: userIdToDelete }
    });

    return res.status(200).json({
      message: "User and all associated data deleted successfully",
      deletedUserId: userIdToDelete
    });

  } catch (error) {
    console.error("Error in deleteUser:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
