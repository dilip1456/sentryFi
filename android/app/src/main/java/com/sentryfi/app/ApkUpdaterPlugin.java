package com.sentryfi.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * In-app updater for the sideloaded APK.
 *
 * Downloads the APK from the one fixed origin, verifies its SHA-256 (from
 * version.json) and its package name and signing certificate against the
 * installed app, then hands it to the system PackageInstaller. Android shows
 * its own confirmation screen and enforces the "install unknown apps"
 * permission and signature continuity itself; nothing here bypasses either.
 *
 * Events: "downloadProgress" {bytes,total}, "installStatus" {status,code,message}.
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    // The only URLs this plugin will download from. Must match src/lib/app-update/config.ts.
    private static final Pattern ALLOWED_URL =
        Pattern.compile("^https://sentryfiapp\\.vercel\\.app/downloads/[A-Za-z0-9._-]+\\.apk(\\?v=[0-9]{1,12})?$");
    private static final Pattern SHA256_HEX = Pattern.compile("^[0-9a-f]{64}$");
    private static final long MAX_BYTES = 200L * 1024 * 1024;
    private static final String APK_FILE = "SentryFi-update.apk";
    private static final String ACTION_INSTALL_STATUS = "com.sentryfi.app.APK_INSTALL_STATUS";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private BroadcastReceiver statusReceiver;

    @Override
    public void load() {
        statusReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                handleInstallStatus(intent);
            }
        };
        ContextCompat.registerReceiver(
            getContext(),
            statusReceiver,
            new IntentFilter(ACTION_INSTALL_STATUS),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (statusReceiver != null) getContext().unregisterReceiver(statusReceiver);
        } catch (Exception ignored) {}
        executor.shutdownNow();
    }

    /** Whether Android currently lets this app request package installs ("Install unknown apps"). */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", canRequestInstalls());
        call.resolve(ret);
    }

    /** Opens the system "Install unknown apps" screen for this app. The user decides; we only navigate. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open settings", "SETTINGS_UNAVAILABLE", e);
        }
    }

    /**
     * Downloads {url} to the app's private cache, verifying size and SHA-256 while streaming,
     * then checks the APK's package name and signing certificate against the installed app.
     * On any mismatch the file is deleted and the call is rejected with a code.
     */
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url", "");
        final String expectedSha = call.getString("sha256", "").toLowerCase(Locale.ROOT);
        final long expectedSize = call.getLong("size", 0L);
        if (!ALLOWED_URL.matcher(url).matches()) {
            call.reject("Update URL is not allowed", "URL_NOT_ALLOWED");
            return;
        }
        if (!SHA256_HEX.matcher(expectedSha).matches()) {
            call.reject("Missing or invalid sha256", "INVALID_SHA256");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("An update download is already running", "BUSY");
            return;
        }
        executor.execute(() -> {
            File out = apkFile();
            try {
                String actual = downloadTo(url, out, expectedSize);
                if (!actual.equals(expectedSha)) {
                    deleteQuietly(out);
                    call.reject("Downloaded file failed the SHA-256 check", "SHA256_MISMATCH");
                    return;
                }
                JSObject ret = inspect(out);
                String err = ret.getString("error");
                if (err != null) {
                    deleteQuietly(out);
                    call.reject(ret.getString("message"), err);
                    return;
                }
                ret.put("sha256", actual);
                ret.put("size", out.length());
                call.resolve(ret);
            } catch (Exception e) {
                deleteQuietly(out);
                String code = e instanceof SizeException ? "SIZE_MISMATCH" : "DOWNLOAD_FAILED";
                call.reject(e.getMessage() != null ? e.getMessage() : "Download failed", code, e);
            } finally {
                busy.set(false);
            }
        });
    }

    /**
     * Re-verifies the downloaded APK (hash + signer, so nothing could have swapped it since
     * download) and commits it to a PackageInstaller session. Android then shows its own
     * install confirmation. The final outcome arrives as an "installStatus" event; on success
     * Android replaces the running app, so JS usually only ever sees failures.
     */
    @PluginMethod
    public void install(PluginCall call) {
        final String expectedSha = call.getString("sha256", "").toLowerCase(Locale.ROOT);
        if (!SHA256_HEX.matcher(expectedSha).matches()) {
            call.reject("Missing or invalid sha256", "INVALID_SHA256");
            return;
        }
        if (!canRequestInstalls()) {
            call.reject("Allow SentryFi to install unknown apps first", "INSTALL_PERMISSION_REQUIRED");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("An update is already in progress", "BUSY");
            return;
        }
        executor.execute(() -> {
            File apk = apkFile();
            try {
                if (!apk.isFile()) {
                    call.reject("Update file is missing; download it again", "FILE_MISSING");
                    return;
                }
                if (!sha256(apk).equals(expectedSha)) {
                    deleteQuietly(apk);
                    call.reject("Update file failed the SHA-256 check", "SHA256_MISMATCH");
                    return;
                }
                JSObject info = inspect(apk);
                if (info.getString("error") != null) {
                    deleteQuietly(apk);
                    call.reject(info.getString("message"), info.getString("error"));
                    return;
                }
                commitSession(apk);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Install failed", "INSTALL_FAILED", e);
            } finally {
                busy.set(false);
            }
        });
    }

    // ── internals ───────────────────────────────────────────────────────────

    private boolean canRequestInstalls() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true; // governed by the global "Unknown sources" switch
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private File apkFile() {
        File dir = new File(getContext().getCacheDir(), "updates");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return new File(dir, APK_FILE);
    }

    private static class SizeException extends IOException {
        SizeException(String m) { super(m); }
    }

    private String downloadTo(String url, File out, long expectedSize) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(false); // stay on the pinned origin
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("Cache-Control", "no-cache");
        try {
            int code = conn.getResponseCode();
            if (code != 200) throw new IOException("Server returned HTTP " + code);
            long total = conn.getContentLengthLong();
            if (total > MAX_BYTES || (expectedSize > 0 && total > 0 && total != expectedSize)) {
                throw new SizeException("Unexpected download size");
            }
            if (total <= 0) total = expectedSize;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long bytes = 0;
            long lastEmit = 0;
            try (InputStream in = conn.getInputStream(); OutputStream os = new FileOutputStream(out, false)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    bytes += n;
                    if (bytes > MAX_BYTES || (expectedSize > 0 && bytes > expectedSize)) {
                        throw new SizeException("Download is larger than expected");
                    }
                    md.update(buf, 0, n);
                    os.write(buf, 0, n);
                    long now = System.currentTimeMillis();
                    if (now - lastEmit > 150) {
                        lastEmit = now;
                        emitProgress(bytes, total);
                    }
                }
            }
            if (expectedSize > 0 && bytes != expectedSize) throw new SizeException("Download size mismatch");
            emitProgress(bytes, total > 0 ? total : bytes);
            return hex(md.digest());
        } finally {
            conn.disconnect();
        }
    }

    private void emitProgress(long bytes, long total) {
        JSObject p = new JSObject();
        p.put("bytes", bytes);
        p.put("total", total);
        notifyListeners("downloadProgress", p);
    }

    /** Package name / version of the APK and whether its signer matches the installed app. */
    @SuppressWarnings("deprecation")
    private JSObject inspect(File apk) {
        JSObject ret = new JSObject();
        PackageManager pm = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (archive == null) {
            ret.put("error", "INVALID_APK");
            ret.put("message", "The downloaded file is not a valid Android app");
            return ret;
        }
        String self = getContext().getPackageName();
        if (!self.equals(archive.packageName)) {
            ret.put("error", "PACKAGE_MISMATCH");
            ret.put("message", "The downloaded app is not SentryFi");
            return ret;
        }
        long archiveCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? archive.getLongVersionCode() : archive.versionCode;
        ret.put("versionCode", archiveCode);
        ret.put("versionName", archive.versionName);
        try {
            PackageInfo installed = pm.getPackageInfo(self, flags);
            Set<String> archiveSigners = signers(archive, false);
            Set<String> installedSigners = signers(installed, true);
            if (archiveSigners.isEmpty() || installedSigners.isEmpty()) {
                // Could not read certificates on this Android build: leave the decision to the
                // PackageInstaller, which always enforces signature continuity.
                ret.put("signatureMatch", JSObject.NULL);
            } else {
                archiveSigners.retainAll(installedSigners);
                if (archiveSigners.isEmpty()) {
                    ret.put("error", "SIGNATURE_MISMATCH");
                    ret.put("message", "This update is signed with a different key than the installed app");
                    return ret;
                }
                ret.put("signatureMatch", true);
            }
        } catch (PackageManager.NameNotFoundException e) {
            ret.put("signatureMatch", JSObject.NULL);
        }
        return ret;
    }

    /** SHA-256 digests of the signing certs. For the installed app, include rotated-out ancestors. */
    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo info, boolean includeHistory) {
        Set<String> out = new HashSet<>();
        Signature[] sigs = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo si = info.signingInfo;
            if (si != null) {
                if (si.hasMultipleSigners()) {
                    sigs = si.getApkContentsSigners();
                } else if (includeHistory) {
                    sigs = si.getSigningCertificateHistory();
                } else {
                    Signature[] h = si.getSigningCertificateHistory();
                    if (h != null && h.length > 0) sigs = new Signature[] { h[h.length - 1] };
                }
            }
        } else {
            sigs = info.signatures;
        }
        if (sigs == null) return out;
        for (Signature s : sigs) {
            try {
                out.add(hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())));
            } catch (Exception ignored) {}
        }
        return out;
    }

    private void commitSession(File apk) throws IOException {
        PackageInstaller installer = getContext().getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
            new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(getContext().getPackageName());
        params.setSize(apk.length());
        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (InputStream in = new FileInputStream(apk);
                 OutputStream os = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) os.write(buf, 0, n);
                session.fsync(os);
            }
            Intent intent = new Intent(ACTION_INSTALL_STATUS).setPackage(getContext().getPackageName());
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            // PackageInstaller fills in the status extras, so the PendingIntent must be mutable.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) piFlags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(getContext(), sessionId, intent, piFlags);
            session.commit(pi.getIntentSender());
        } catch (IOException | RuntimeException e) {
            try { installer.abandonSession(sessionId); } catch (Exception ignored) {}
            throw e;
        }
    }

    @SuppressWarnings("deprecation")
    private void handleInstallStatus(Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    getContext().startActivity(confirm);
                } catch (Exception e) {
                    emitStatus("failure", "INSTALL_FAILED", "Could not open the Android installer");
                }
            }
            emitStatus("pending", null, null);
            return;
        }
        String code;
        switch (status) {
            case PackageInstaller.STATUS_SUCCESS: code = null; break;
            case PackageInstaller.STATUS_FAILURE_ABORTED: code = "ABORTED"; break;
            case PackageInstaller.STATUS_FAILURE_BLOCKED: code = "BLOCKED"; break;
            case PackageInstaller.STATUS_FAILURE_CONFLICT: code = "CONFLICT"; break;
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE: code = "INCOMPATIBLE"; break;
            case PackageInstaller.STATUS_FAILURE_INVALID: code = "INVALID"; break;
            case PackageInstaller.STATUS_FAILURE_STORAGE: code = "STORAGE"; break;
            default: code = "INSTALL_FAILED";
        }
        // Signature mismatches surface as CONFLICT/INCOMPATIBLE with this message.
        if (message != null && message.contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE")) code = "SIGNATURE_MISMATCH";
        if (status == PackageInstaller.STATUS_SUCCESS) deleteQuietly(apkFile());
        emitStatus(status == PackageInstaller.STATUS_SUCCESS ? "success" : "failure", code, message);
    }

    private void emitStatus(String status, String code, String message) {
        JSObject s = new JSObject();
        s.put("status", status);
        if (code != null) s.put("code", code);
        if (message != null) s.put("message", message);
        notifyListeners("installStatus", s, true);
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) md.update(buf, 0, n);
        }
        return hex(md.digest());
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    private static void deleteQuietly(File f) {
        try {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        } catch (Exception ignored) {}
    }
}
