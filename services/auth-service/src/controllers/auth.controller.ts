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
    const url = `${process.env.APP_URL}/api/verify/verify-email?email=${payload.email}&token=${token}`;
    const emailBody = await renderEmailEjs("email-verify", {
      name: payload.name,
      url,
    });

    //Send Email
    await emailQueue.add(emailQueueName, {
      to: payload.email,
      subject: "Jibbr | Verify your email",
      body: emailBody,
    });

    await prisma.user.create({
      data: {
        name: payload.name,
        email: payload.email,
        password: payload.password,
        email_verify_token: token,
      },
    });

    return res
      .status(201)
      .json({ message: "Please check your email to verify your account" });
  } catch (error) {
    // console.log("Error in register controller:", error);
    if (error instanceof ZodError) {
      const errors = formatError(error);
      res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
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
    // console.log("Error in Login controller:", error);
    if (error instanceof ZodError) {
      const errors = formatError(error);
      res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const logout = async (req: Request, res: Response) => {
  res.send("Logged out successfully!");
};

export const verifyEmail = async (req: Request, res: Response) => {
  const { email, token } = req.query;
  if (email && token) {
    const user = await prisma.user.findUnique({
      where: { email: email as string },
    });

    if (user) {
      if (token === user.email_verify_token) {
        //Redirect to front page
        await prisma.user.update({
          data: {
            email_verify_token: null,
            email_verified_at: new Date().toISOString(),
          },
          where: { email: email as string },
        });
        return res.redirect(`${process.env.CLIENT_APP_URL}/login`);
      }
    }
    res.redirect("/verify-error");
  }
  res.redirect("/verify-error");
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

   const salt = await bcrypt.genSalt(10);
   const token = await bcrypt.hash(uuidv4(), salt);
   await prisma.user.update({
    data:{
      password_reset_token: token,
      token_send_at: new Date().toISOString()
    },
    where:{ email: payload.email}
   })
   const url = `${process.env.CLIENT_APP_URL}/forget-reset-password?email=${payload.email}&token=${token}`;

   const html = await renderEmailEjs("forget-password", {
    url,
   });

   await emailQueue.add(emailQueueName, {
    to: payload.email,
    subject: "Jibbr | Reset Password",
    body: html,
   });

   return res.status(200).json({message: "Password reset email sent"})
  } catch (error) {
    // console.log("Error in forgetPassword controller:", error);
    if (error instanceof ZodError) {
      const errors = formatError(error);
      res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
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
    
    
  }
  catch (error) {
    // console.log("Error in resetPassword controller:", error);
    if (error instanceof ZodError) {
      const errors = formatError(error);
      res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
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
    // console.log("Error in resetPassword controller:", error);
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
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
