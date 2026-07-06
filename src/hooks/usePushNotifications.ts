import { useEffect } from "react";
import { PushNotifications, type Token } from "@capacitor/push-notifications";
import { isNative } from "@/lib/capacitor-oauth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const usePushNotifications = (userId: string | undefined) => {
  useEffect(() => {
    if (!isNative() || !userId) return;

    const setup = async () => {
      // Request permission
      const result = await PushNotifications.requestPermissions();
      if (result.receive !== "granted") return;

      await PushNotifications.register();

      // Save FCM token to Supabase so server can send pushes
      PushNotifications.addListener("registration", async (token: Token) => {
        await supabase.from("push_tokens").upsert({
          user_id: userId,
          token: token.value,
          platform: "android",
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,platform" });
      });

      // Handle push received while app is open
      PushNotifications.addListener("pushNotificationReceived", (notification) => {
        toast(notification.title ?? "SentryFi", {
          description: notification.body,
        });
      });

      // Handle tap on push notification
      PushNotifications.addListener("pushNotificationActionPerformed", () => {
        // Already in app — just surface it via toast, routing can be added later
      });
    };

    setup().catch(console.error);

    return () => { PushNotifications.removeAllListeners(); };
  }, [userId]);
};
