package com.sentryfi.app;

import java.io.File;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Pure-Java decision helpers for {@link ApkUpdaterPlugin}. No Android APIs here, so every rule
 * that guards an install (hash comparison, signer comparison, which cached files may be deleted)
 * is covered by plain JVM unit tests (android/app/src/test/.../ApkUpdateChecksTest.java).
 */
final class ApkUpdateChecks {

    private ApkUpdateChecks() {}

    /** Exactly 64 lowercase hex chars. Callers normalise case first; nothing else is accepted. */
    static final Pattern SHA256_HEX = Pattern.compile("^[0-9a-f]{64}$");

    /** Prefix shared by every file this plugin writes into its cache subfolder. */
    static final String FILE_PREFIX = "SentryFi-update";

    static boolean isValidSha256Hex(String s) {
        return s != null && SHA256_HEX.matcher(s).matches();
    }

    /** Decodes a validated lowercase hex string; returns null if it isn't 64 lowercase hex chars. */
    static byte[] sha256HexToBytes(String hex) {
        if (!isValidSha256Hex(hex)) return null;
        byte[] out = new byte[32];
        for (int i = 0; i < 32; i++) {
            out[i] = (byte) ((Character.digit(hex.charAt(2 * i), 16) << 4) | Character.digit(hex.charAt(2 * i + 1), 16));
        }
        return out;
    }

    /**
     * Constant-time comparison of a 32-byte SHA-256 digest with the expected lowercase hex string.
     * False if the expected value is malformed or the digest isn't 32 bytes.
     */
    static boolean sha256Matches(String expectedHex, byte[] actualDigest) {
        byte[] expected = sha256HexToBytes(expectedHex);
        if (expected == null || actualDigest == null || actualDigest.length != 32) return false;
        return MessageDigest.isEqual(expected, actualDigest);
    }

    enum SignerVerdict { MATCH, MISMATCH }

    /**
     * The downloaded APK's signer set must EQUAL the installed app's signer set (SHA-256 digests
     * of the signing certificates, current signers only, no rotated-out ancestors). Fails closed:
     * an empty/unreadable set on either side is a mismatch, never "unknown".
     */
    static SignerVerdict compareSigners(Set<String> installed, Set<String> downloaded) {
        if (installed == null || downloaded == null || installed.isEmpty() || downloaded.isEmpty()) {
            return SignerVerdict.MISMATCH;
        }
        return installed.equals(downloaded) ? SignerVerdict.MATCH : SignerVerdict.MISMATCH;
    }

    /**
     * Whether a cached update APK is stale. It is stale (delete it) when its versionCode couldn't
     * be read (corrupt/partial file) or the installed app is already at or past that version.
     */
    static boolean isCachedApkStale(long installedVersionCode, Long cachedVersionCode) {
        return cachedVersionCode == null || installedVersionCode >= cachedVersionCode;
    }

    /** True for names this plugin itself writes ("SentryFi-update.apk", "SentryFi-update.apk.part", ...). */
    static boolean isOwnCacheFileName(String name) {
        return name != null && name.startsWith(FILE_PREFIX) && !name.contains("/") && !name.contains("\\");
    }

    /**
     * True only if {@code f} is a regular file directly inside {@code dir} (after resolving
     * symlinks and "..") and has one of this plugin's own file names. The cleanup code never
     * deletes anything that fails this check.
     */
    static boolean isDeletableCacheFile(File dir, File f) {
        if (dir == null || f == null) return false;
        try {
            File canonDir = dir.getCanonicalFile();
            File canonFile = f.getCanonicalFile();
            File parent = canonFile.getParentFile();
            if (parent == null || !parent.equals(canonDir)) return false;
            // A symlink placed in the folder resolves elsewhere and fails the parent check above;
            // also require the un-resolved path to sit in the folder.
            File rawParent = f.getAbsoluteFile().getParentFile();
            if (rawParent == null || !rawParent.getCanonicalFile().equals(canonDir)) return false;
            return canonFile.isFile() && isOwnCacheFileName(canonFile.getName()) && isOwnCacheFileName(f.getName());
        } catch (IOException | SecurityException e) {
            return false;
        }
    }

    /** The files in {@code dir} that {@link #isDeletableCacheFile} allows deleting. */
    static List<File> ownCacheFiles(File dir) {
        List<File> out = new ArrayList<>();
        File[] list = dir == null ? null : dir.listFiles();
        if (list == null) return out;
        for (File f : list) if (isDeletableCacheFile(dir, f)) out.add(f);
        return out;
    }

    /** Deletes every file {@link #ownCacheFiles} returns. Returns how many were deleted. */
    static int deleteOwnCacheFiles(File dir) {
        return deleteOwnCacheFiles(dir, ownCacheFiles(dir));
    }

    /** Deletes the given files, re-checking each one is one of ours inside {@code dir}. */
    static int deleteOwnCacheFiles(File dir, Collection<File> files) {
        int n = 0;
        for (File f : files) {
            if (isDeletableCacheFile(dir, f)) {
                try {
                    if (f.delete()) n++;
                } catch (SecurityException ignored) {}
            }
        }
        return n;
    }

    static String hex(byte[] b) {
        char[] digits = "0123456789abcdef".toCharArray();
        char[] out = new char[b.length * 2];
        for (int i = 0; i < b.length; i++) {
            out[2 * i] = digits[(b[i] >> 4) & 0xf];
            out[2 * i + 1] = digits[b[i] & 0xf];
        }
        return new String(out);
    }
}
