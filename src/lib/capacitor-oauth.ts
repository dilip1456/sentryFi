import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { supabase } from "@/integrations/supabase/client";

// Custom scheme the Android app registers an intent-filter for (see android/app/src/main/AndroidManifest.xml).
// Google's own "Authorized redirect URI" doesn't change — that's still Supabase's own callback URL.
// This is only the URL Supabase redirects *back to our app* with after it finishes the OAuth handshake,
// so it must also be added to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.
export const OAUTH_REDIRECT_URL = "com.sentryfi.app://login-callback";

export const isNative = () => Capacitor.isNativePlatform();

/**
 * On web, behaves exactly as before (full-page redirect through Google, back to this origin).
 * On native, opens Google sign-in in an in-app browser tab instead of navigating the WebView itself —
 * navigating the WebView directly to a non-existent "https://localhost" is what causes
 * "site can't be reached" on-device. The resulting deep link is handled in AuthContext's appUrlOpen listener.
 */
export const signInWithGoogle = async () => {
  if (!isNative()) {
    return supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: OAUTH_REDIRECT_URL, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return { error };
  await Browser.open({ url: data.url });
  return { error: null };
};
