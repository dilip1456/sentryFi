import { useEffect } from "react";
import { isNative } from "@/lib/capacitor-oauth";
import { supabase } from "@/integrations/supabase/client";

export const usePushNotifications = (userId: string | undefined) => {
  useEffect(() => {
    if (!isNative() || !userId) return;
    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const result = await PushNotifications.requestPermissions();
        if (result.receive !== "granted") return;
        await PushNotifications.register();
        PushNotifications.addListener("registration", async (token) => {
          try {
            await supabase.from("push_tokens").upsert({
              user_id: userId, token: token.value,
              platform: "android", updated_at: new Date().toISOString(),
            }, { onConflict: "user_id,platform" });
          } catch {}
        });
        PushNotifications.addListener("pushNotificationReceived", (n) => {
          import("sonner").then(({ toast }) => toast(n.title ?? "Sentry Finance", { description: n.body }));
        });
      } catch (e) {
        // Missing google-services.json or emulator — silent fail
        console.warn("[push] not available:", e);
      }
    })();
  }, [userId]);
};
