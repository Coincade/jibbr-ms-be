import { Request, Response } from "express";
import { getOnlineUsers, isUserOnline, getUsersOnlineStatus, getOnlineUsersCount } from "../websocket/index.js";

export const getOnlineUsersList = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const onlineUsers = getOnlineUsers();
    
    return res.status(200).json({
      message: "Online users fetched successfully",
      data: {
        onlineUsers,
        count: onlineUsers.length
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const checkUserOnlineStatus = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { userId } = req.params;
    const isOnline = isUserOnline(userId);
    
    return res.status(200).json({
      message: "User online status fetched successfully",
      data: {
        userId,
        isOnline
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const checkMultipleUsersStatus = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { userIds } = req.body;
    
    if (!Array.isArray(userIds)) {
      return res.status(400).json({ message: "userIds must be an array" });
    }

    const statuses = getUsersOnlineStatus(userIds);
    
    return res.status(200).json({
      message: "Users online status fetched successfully",
      data: statuses
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getOnlineStats = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const onlineCount = getOnlineUsersCount();
    
    return res.status(200).json({
      message: "Online stats fetched successfully",
      data: {
        onlineUsersCount: onlineCount
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};
