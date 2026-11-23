import prisma from '../config/database.js';
import type { ErpLinkRecord, ErpRepository } from './erp.js';

function toRecord(row: {
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessExpiresAt: Date | null;
  employeeExternalId: string | null;
  employeeName: string | null;
  roleId: string | null;
  roleName: string | null;
  oauthState: string | null;
  oauthStateExpiresAt: Date | null;
}): ErpLinkRecord {
  return {
    userId: row.userId,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    accessExpiresAt: row.accessExpiresAt,
    employeeExternalId: row.employeeExternalId,
    employeeName: row.employeeName,
    roleId: row.roleId,
    roleName: row.roleName,
    oauthState: row.oauthState,
    oauthStateExpiresAt: row.oauthStateExpiresAt,
  };
}

export const erpRepository: ErpRepository = {
  async findByUser(userId) {
    const row = await prisma.erpLink.findUnique({ where: { userId } });
    return row ? toRecord(row) : null;
  },
  async findByState(state) {
    const row = await prisma.erpLink.findUnique({ where: { oauthState: state } });
    return row ? toRecord(row) : null;
  },
  async upsertPending(userId, state, expiresAt) {
    await prisma.erpLink.upsert({
      where: { userId },
      create: { userId, oauthState: state, oauthStateExpiresAt: expiresAt },
      update: { oauthState: state, oauthStateExpiresAt: expiresAt },
    });
  },
  async saveConnection(userId, connection) {
    await prisma.erpLink.update({
      where: { userId },
      data: {
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        accessExpiresAt: connection.accessExpiresAt,
        employeeExternalId: connection.employeeExternalId || null,
        employeeName: connection.employeeName || null,
        roleId: connection.roleId || null,
        roleName: connection.roleName || null,
        connectedAt: connection.connectedAt,
        oauthState: null,
        oauthStateExpiresAt: null,
      },
    });
  },
  async clearState(userId) {
    await prisma.erpLink.update({
      where: { userId },
      data: { oauthState: null, oauthStateExpiresAt: null },
    });
  },
  async deleteByUser(userId) {
    await prisma.erpLink.deleteMany({ where: { userId } });
  },
  async updateTokens(userId, tokens) {
    await prisma.erpLink.update({
      where: { userId },
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresAt: tokens.accessExpiresAt,
      },
    });
  },
};
