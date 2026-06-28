import { env } from './env';

export type FeatureFlagKey =
  | 'tempChannelLifecycle'
  | 'tempChannelOwnerControls'
  | 'supportTickets'
  | 'adminApi'
  | 'antiSpamSecurity'
  | 'automationRecovery'
  | 'welcomeAndRules'
  | 'afkSystem'
  | 'vipSystem'
  | 'dailyAdminStats'
  | 'staffAuditLog';

export const featureFlags: Record<FeatureFlagKey, boolean> = {
  tempChannelLifecycle: env.FEATURE_TEMP_CHANNEL_LIFECYCLE,
  tempChannelOwnerControls: env.FEATURE_TEMP_CHANNEL_OWNER_CONTROLS,
  supportTickets: env.FEATURE_SUPPORT_TICKETS,
  adminApi: env.FEATURE_ADMIN_API,
  antiSpamSecurity: env.FEATURE_ANTI_SPAM_SECURITY,
  automationRecovery: env.FEATURE_AUTOMATION_RECOVERY,
  welcomeAndRules: env.FEATURE_WELCOME_AND_RULES,
  afkSystem: env.FEATURE_AFK_SYSTEM,
  vipSystem: env.FEATURE_VIP_SYSTEM,
  dailyAdminStats: env.FEATURE_DAILY_ADMIN_STATS,
  staffAuditLog: env.FEATURE_STAFF_AUDIT_LOG
};
