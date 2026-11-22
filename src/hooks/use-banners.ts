/**
 * The studio's shared error/notice banners — the single "say something to the user" surface every
 * capability reports through (edit failures, history-write failures, import/export results,
 * project operations). Two slots exactly: a red `role="alert"` error banner and a green
 * `role="status"` notice (rendered by `components/AppBanners.tsx`); both are cleared together by
 * `clearMessages()` whenever the working state resets (root/project switches, export open).
 */

import { useState } from 'react';

export function useBanners() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  return {
    errorMessage,
    noticeMessage,
    setErrorMessage,
    setNoticeMessage,
    clearMessages() {
      setErrorMessage(null);
      setNoticeMessage(null);
    },
  };
}

export type Banners = ReturnType<typeof useBanners>;
