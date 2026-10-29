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
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * In-app updater for the sideloaded APK.
 *
 * Downloads the APK from the one fixed origin, verifies its SHA-256 (from
 * version.json, compared in constant time) and its package name and signer set
 * (must equal the installed app's) against the installed app, then hands it to
 * the system PackageInstaller. Android shows its own confirmation screen and
 * enforces the "install unknown apps" permission and signature continuity
 * itself; nothing here bypasses either.
 *
 * Downloaded files live only in cache/updates/ and are removed before each new
 * download, on any failure, once they have been copied into a PackageInstaller
 * session, and on plugin load when the installed versionCode has caught up.
 * Pure decision logic lives in {@link ApkUpdateChecks} (JVM unit-tested).
 *
 * Events: "downloadProgress" {bytes,total}, "installStatus" {status,code,message}.
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    // The only URLs this plugin will download from. Must match src/lib/app-update/config.ts.
    private static final Pattern ALLOWED_URL =
        Pattern.compile("^https://sentryfiapp\\.vercel\\.app/downloads/[A-Za-z0-9._-]+\\.apk(\\?v=[0-9]{1,12})?$");
    private static final long MAX_BYTES = 200L * 1024 * 1024;
    private static final String UPDATES_DIR = "updates";
    // Both names start with ApkUpdateChecks.FILE_PREFIX, so cache cleanup recognises them.
    private static final String APK_FILE = ApkUpdateChecks.FILE_PREFIX + ".apk";
    private static final String PART_FILE = ApkUpdateChecks.FILE_PREFIX + ".apk.part";
    private static final String SIGNATURE_MISMATCH_MSG = "This update is signed with a different key than the installed app";
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
        // An update that installed successfully replaces this process before the success
        // broadcast can delete the file, so tidy up here on the next start. Runs on the same
        // single-thread executor as download/install, so it can't race them.
        try {
            executor.execute(this::cleanupStaleCache);
        } catch (RuntimeException ignored) {}
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
        final String expectedSha = call.getString("sha256", "");
        final long expectedSize = call.getLong("size", 0L);
        if (!ALLOWED_URL.matcher(url).matches()) {
            call.reject("Update URL is not allowed", "URL_NOT_ALLOWED");
            return;
        }
        if (!ApkUpdateChecks.isValidSha256Hex(expectedSha)) {
            call.reject("Missing or invalid sha256", "INVALID_SHA256");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("An update download is already running", "BUSY");
            return;
        }
        executor.execute(() -> {
            File dir = updatesDir();
            // Never keep an older download around: start every download from an empty folder.
            ApkUpdateChecks.deleteOwnCacheFiles(dir);
            File part = new File(dir, PART_FILE);
            File out = new File(dir, APK_FILE);
            try {
                byte[] digest = downloadTo(url, part, expectedSize);
                if (!ApkUpdateChecks.sha256Matches(expectedSha, digest)) {
                    ApkUpdateChecks.deleteOwnCacheFiles(dir);
                    call.reject("Downloaded file failed the SHA-256 check", "SHA256_MISMATCH");
                    return;
                }
                if (!part.renameTo(out)) throw new IOException("Could not save the downloaded update");
                JSObject ret = inspect(out);
                String err = ret.getString("error");
                if (err != null) {
                    ApkUpdateChecks.deleteOwnCacheFiles(dir);
                    call.reject(ret.getString("message"), err);
                    return;
                }
                ret.put("sha256", ApkUpdateChecks.hex(digest));
                ret.put("size", out.length());
                call.resolve(ret);
            } catch (Exception e) {
                ApkUpdateChecks.deleteOwnCacheFiles(dir);
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
        final String expectedSha = call.getString("sha256", "");
        if (!ApkUpdateChecks.isValidSha256Hex(expectedSha)) {
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
            File dir = updatesDir();
            File apk = new File(dir, APK_FILE);
            try {
                if (!apk.isFile()) {
                    call.reject("Update file is missing; download it again", "FILE_MISSING");
                    return;
                }
                if (!ApkUpdateChecks.sha256Matches(expectedSha, sha256(apk))) {
                    ApkUpdateChecks.deleteOwnCacheFiles(dir);
                    call.reject("Update file failed the SHA-256 check", "SHA256_MISMATCH");
                    return;
                }
                JSObject info = inspect(apk);
                if (info.getString("error") != null) {
                    ApkUpdateChecks.deleteOwnCacheFiles(dir);
                    call.reject(info.getString("message"), info.getString("error"));
                    return;
                }
                commitSession(apk);
                // The bytes now live in the PackageInstaller session; the cached copy is no
                // longer needed whatever the user picks on Android's confirmation screen (the
                // JS flow always downloads again before installing again).
                ApkUpdateChecks.deleteOwnCacheFiles(dir);
                call.resolve();
            } catch (Exception e) {
                ApkUpdateChecks.deleteOwnCacheFiles(dir);
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

    /** The plugin's own cache subfolder. Nothing outside it is ever written or deleted. */
    private File updatesDir() {
        File dir = new File(getContext().getCacheDir(), UPDATES_DIR);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    /**
     * Deletes leftover downloads: partial files always, and the downloaded APK when it can't be
     * parsed or the installed app's versionCode is already >= the APK's.
     */
    private void cleanupStaleCache() {
        try {
            File dir = updatesDir();
            long installedCode = installedVersionCode();
            for (File f : ApkUpdateChecks.ownCacheFiles(dir)) {
                Long cachedCode = APK_FILE.equals(f.getName()) ? archiveVersionCode(f) : null;
                if (installedCode < 0 || ApkUpdateChecks.isCachedApkStale(installedCode, cachedCode)) {
                    ApkUpdateChecks.deleteOwnCacheFiles(dir, Collections.singletonList(f));
                }
            }
        } catch (Exception ignored) {
            // Best effort: a leftover file only costs cache space and is replaced by the next download.
        }
    }

    @SuppressWarnings("deprecation")
    private long installedVersionCode() {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) {
            return -1;
        }
    }

    @SuppressWarnings("deprecation")
    private Long archiveVersionCode(File apk) {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
            if (pi == null || !getContext().getPackageName().equals(pi.packageName)) return null;
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : (long) pi.versionCode;
        } catch (Exception e) {
            return null;
        }
    }

    private static class SizeException extends IOException {
        SizeException(String m) { super(m); }
    }

    /** Streams {url} into {out}, enforcing size limits; returns the SHA-256 digest of the bytes. */
    private byte[] downloadTo(String url, File out, long expectedSize) throws Exception {
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
            return md.digest();
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

    /**
     * Package name / version of the APK and whether its signer set equals the installed app's.
     * Fails closed: unreadable or different signers reject with SIGNATURE_MISMATCH.
     */
    @SuppressWarnings("deprecation")
    private JSObject inspect(File apk) {
        JSObject ret = new JSObject();
        PackageManager pm = getContext().getPackageManager();
        // API 24-27: legacy GET_SIGNATURES. API 28+: GET_SIGNING_CERTIFICATES, plus GET_SIGNATURES
        // so the legacy field is available as a fallback if signingInfo comes back null for
        // the archive or the installed app.
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? (PackageManager.GET_SIGNING_CERTIFICATES | PackageManager.GET_SIGNATURES)
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
        Set<String> installedSigners;
        Set<String> archiveSigners;
        try {
            PackageInfo installed = pm.getPackageInfo(self, flags);
            boolean modern = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                && installed.signingInfo != null && archive.signingInfo != null;
            // Both sides are always read the same way, so the sets are comparable.
            installedSigners = modern ? currentSigners(installed.signingInfo) : legacySigners(installed);
            archiveSigners = modern ? currentSigners(archive.signingInfo) : legacySigners(archive);
        } catch (PackageManager.NameNotFoundException e) {
            installedSigners = null;
            archiveSigners = null;
        }
        if (ApkUpdateChecks.compareSigners(installedSigners, archiveSigners) != ApkUpdateChecks.SignerVerdict.MATCH) {
            ret.put("error", "SIGNATURE_MISMATCH");
            ret.put("message", SIGNATURE_MISMATCH_MSG);
            return ret;
        }
        ret.put("signatureMatch", true);
        return ret;
    }

    /**
     * SHA-256 digests of the certificates that currently sign the APK contents (one for a normal
     * app, several for a multi-signer app). Rotated-out ancestors from the signing lineage are
     * deliberately NOT included: an APK signed only with an old key must not pass.
     */
    private static Set<String> currentSigners(SigningInfo si) {
        return digests(Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? si.getApkContentsSigners() : null);
    }

    /** API 24-27 (and API 28+ fallback): the legacy PackageInfo.signatures field. */
    @SuppressWarnings("deprecation")
    private static Set<String> legacySigners(PackageInfo info) {
        return digests(info.signatures);
    }

    private static Set<String> digests(Signature[] sigs) {
        Set<String> out = new HashSet<>();
        if (sigs == null) return out;
        for (Signature s : sigs) {
            if (s == null) continue;
            try {
                out.add(ApkUpdateChecks.hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())));
            } catch (Exception e) {
                // A certificate we can't hash makes the whole set untrustworthy: fail closed.
                return new HashSet<>();
            }
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
        // Any final outcome (success or failure): drop whatever is still cached. Normally the
        // file was already removed right after the session was committed.
        try {
            executor.execute(() -> ApkUpdateChecks.deleteOwnCacheFiles(updatesDir()));
        } catch (RuntimeException ignored) {
            // Executor already shut down (plugin destroyed); load() cleans up on next start.
        }
        emitStatus(status == PackageInstaller.STATUS_SUCCESS ? "success" : "failure", code, message);
    }

    private void emitStatus(String status, String code, String message) {
        JSObject s = new JSObject();
        s.put("status", status);
        if (code != null) s.put("code", code);
        if (message != null) s.put("message", message);
        notifyListeners("installStatus", s, true);
    }

    private static byte[] sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) md.update(buf, 0, n);
        }
        return md.digest();
    }
}
