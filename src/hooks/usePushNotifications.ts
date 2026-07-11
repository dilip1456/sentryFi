import { useEffect } from "react";
import { PushNotifications } from "@capacitor/push-notifications";
import { isNative } from "@/lib/capacitor-oauth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const usePushNotifications = (userId: string | undefined) => {
  useEffect(() => {
    if (!isNative() || !userId) return;

    const setup = async () => {
      try {
        // Request permission
        const { receive } = await PushNotifications.requestPermissions();
        if (receive !== "granted") return;

        // Register with FCM
        await PushNotifications.register();

        // Save token to Supabase so server can push to this device
        await PushNotifications.addListener("registration", async ({ value: token }) => {
          try {
            await supabase.from("push_tokens").upsert({
              user_id: userId,
              token,
              platform: "android",
              updated_at: new Date().toISOString(),
            }, { onConflict: "user_id,platform" });
          } catch (e) {
            console.warn("[push] token save failed:", e);
          }
        });

        // Show notification as toast when app is in foreground
        await PushNotifications.addListener("pushNotificationReceived", (n) => {
          toast(n.title ?? "Sentry Finance", { description: n.body });
        });

        // Handle tap on notification when app is backgrounded
        await PushNotifications.addListener("pushNotificationActionPerformed", () => {
          // App opens to foreground — no extra action needed for now
        });

      } catch (e) {
        // Never crash the app over push setup
        console.warn("[push] setup failed:", e);
      }
    };

    setup();

    return () => {
      PushNotifications.removeAllListeners().catch(() => {});
    };
  }, [userId]);
};
