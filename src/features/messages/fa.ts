export const persianMessages = {
  tempCreated: (input: { channelName: string; password: string }) =>
    `کانال موقت شما ساخته شد ✅\nنام کانال: ${input.channelName}\nرمز ورود: ${input.password}\n\nتا زمانی که داخل کانال باشید فعال می‌ماند. اگر کانال خالی بماند، به‌صورت خودکار حذف می‌شود.`,
  tempReused: (input: { channelName: string; password: string }) =>
    `کانال موقت قبلی شما آماده است ✅\nنام کانال: ${input.channelName}\nرمز ورود: ${input.password}`,
  tempError: () => 'ساخت کانال موقت با خطا روبه‌رو شد. لطفاً چند لحظه بعد دوباره تلاش کنید.',
  ticketCreated: () => 'تیکت پشتیبانی شما ساخته شد ✅\nلطفاً همین‌جا منتظر بمانید تا پشتیبانی وارد شود.',
  ticketReused: () => 'تیکت پشتیبانی قبلی شما آماده است ✅\nلطفاً همین‌جا منتظر بمانید تا پشتیبانی وارد شود.',
  ticketError: () => 'ساخت تیکت پشتیبانی با خطا روبه‌رو شد. لطفاً چند لحظه بعد دوباره تلاش کنید.',
  staffTicketNotification: (input: { nickname: string; channelName: string }) =>
    `تیکت جدید ساخته شد:\nکاربر: ${input.nickname}\nکانال: ${input.channelName}`,
  tempPasswordVerificationFailed: () => 'تنظیم رمز کانال با خطا روبه‌رو شد. لطفاً چند لحظه بعد دوباره تلاش کنید.',
  adminFeatureDisabled: () => 'این بخش در حال حاضر غیرفعال است.'
};
