import { useEffect } from "react";
import { isNative } from "@/lib/capacitor-oauth";

/**
 * Push notifications — fully disabled until Firebase is configured.
 * The permission prompt was crashing the app because google-services.json
 * is not present, so FCM registration always fails.
 *
 * To enable: add google-services.json to android/app/ and uncomment below.
 */
export const usePushNotifications = (_userId: string | undefined) => {
  useEffect(() => {
    // DISABLED — requires google-services.json (Firebase setup)
    // Without it, PushNotifications.register() throws after permission granted
    // which crashes the whole app.
    if (!isNative()) return;
    // TODO: enable when Firebase project is configured
  }, [_userId]);
};
