package com.sentryfi.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class ApkUpdateChecksTest {

    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static byte[] sha(String s) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
    }

    private static final String ABC_HEX = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    // ── finding 1: SHA-256 ──────────────────────────────────────────────────

    @Test public void validatesSha256Hex() {
        assertTrue(ApkUpdateChecks.isValidSha256Hex(ABC_HEX));
        assertFalse(ApkUpdateChecks.isValidSha256Hex(null));
        assertFalse(ApkUpdateChecks.isValidSha256Hex(""));
        assertFalse(ApkUpdateChecks.isValidSha256Hex(ABC_HEX.toUpperCase()));
        assertFalse(ApkUpdateChecks.isValidSha256Hex(ABC_HEX.substring(1)));
        assertFalse(ApkUpdateChecks.isValidSha256Hex(ABC_HEX + "0"));
        assertFalse(ApkUpdateChecks.isValidSha256Hex(" " + ABC_HEX.substring(1)));
        assertFalse(ApkUpdateChecks.isValidSha256Hex(ABC_HEX.substring(0, 63) + "g"));
        assertFalse(ApkUpdateChecks.isValidSha256Hex(ABC_HEX + "\n"));
    }

    @Test public void decodesHex() throws Exception {
        assertArrayEquals(sha("abc"), ApkUpdateChecks.sha256HexToBytes(ABC_HEX));
        assertNull(ApkUpdateChecks.sha256HexToBytes("zz"));
        assertEquals(ABC_HEX, ApkUpdateChecks.hex(sha("abc")));
        assertEquals("00ff7f80", ApkUpdateChecks.hex(new byte[] {0, (byte) 0xff, 0x7f, (byte) 0x80}));
    }

    @Test public void sha256MatchesOnlyExactDigest() throws Exception {
        assertTrue(ApkUpdateChecks.sha256Matches(ABC_HEX, sha("abc")));
        assertFalse(ApkUpdateChecks.sha256Matches(ABC_HEX, sha("abd")));
        byte[] flipped = sha("abc");
        flipped[31] ^= 1;
        assertFalse(ApkUpdateChecks.sha256Matches(ABC_HEX, flipped));
        assertFalse(ApkUpdateChecks.sha256Matches(ABC_HEX.toUpperCase(), sha("abc")));
        assertFalse(ApkUpdateChecks.sha256Matches(null, sha("abc")));
        assertFalse(ApkUpdateChecks.sha256Matches(ABC_HEX, null));
        assertFalse(ApkUpdateChecks.sha256Matches(ABC_HEX, Arrays.copyOf(sha("abc"), 31)));
        assertFalse(ApkUpdateChecks.sha256Matches(ABC_HEX, Arrays.copyOf(sha("abc"), 33)));
    }

    // ── finding 2: signer set equality ──────────────────────────────────────

    private static Set<String> set(String... s) { return new HashSet<>(Arrays.asList(s)); }

    @Test public void signersMustBeEqualSets() {
        assertEquals(ApkUpdateChecks.SignerVerdict.MATCH, ApkUpdateChecks.compareSigners(set("a"), set("a")));
        assertEquals(ApkUpdateChecks.SignerVerdict.MATCH, ApkUpdateChecks.compareSigners(set("a", "b"), set("b", "a")));
        // Overlap is not enough (the old retainAll behaviour accepted these).
        assertEquals(ApkUpdateChecks.SignerVerdict.MISMATCH, ApkUpdateChecks.compareSigners(set("a", "b"), set("a")));
        assertEquals(ApkUpdateChecks.SignerVerdict.MISMATCH, ApkUpdateChecks.compareSigners(set("a"), set("a", "evil")));
        assertEquals(ApkUpdateChecks.SignerVerdict.MISMATCH, ApkUpdateChecks.compareSigners(set("a"), set("b")));
    }

    @Test public void signersFailClosedWhenUnreadable() {
        assertEquals(ApkUpdateChecks.SignerVerdict.MISMATCH, ApkUpdateChecks.compareSigners(set(), set()));
        assertEquals(ApkUpdateChecks.SignerVerdict.MISMATCH, ApkUpdateChecks.compareSigners(set("a"), set()));
        assertEquals(ApkUpdateChecks.SignerVerdict.MISMATCH, ApkUpdateChecks.compareSigners(set(), set("a")));
        assertEquals(ApkUpdateChecks.SignerVerdict.MISMATCH, ApkUpdateChecks.compareSigners(null, set("a")));
        assertEquals(ApkUpdateChecks.SignerVerdict.MISMATCH, ApkUpdateChecks.compareSigners(set("a"), null));
    }

    // ── finding 3: cache cleanup ────────────────────────────────────────────

    @Test public void staleWhenInstalledCaughtUpOrUnreadable() {
        assertTrue(ApkUpdateChecks.isCachedApkStale(1207, 1207L));
        assertTrue(ApkUpdateChecks.isCachedApkStale(1208, 1207L));
        assertTrue(ApkUpdateChecks.isCachedApkStale(1207, null));
        assertFalse(ApkUpdateChecks.isCachedApkStale(1206, 1207L));
    }

    @Test public void ownFileNames() {
        assertTrue(ApkUpdateChecks.isOwnCacheFileName("SentryFi-update.apk"));
        assertTrue(ApkUpdateChecks.isOwnCacheFileName("SentryFi-update.apk.part"));
        assertFalse(ApkUpdateChecks.isOwnCacheFileName("other.apk"));
        assertFalse(ApkUpdateChecks.isOwnCacheFileName(null));
        assertFalse(ApkUpdateChecks.isOwnCacheFileName("SentryFi-update/../x"));
    }

    private static File touch(File f) throws IOException {
        f.getParentFile().mkdirs();
        try (FileOutputStream os = new FileOutputStream(f)) { os.write(1); }
        return f;
    }

    @Test public void deletesOnlyOwnFilesInsideTheUpdatesFolder() throws Exception {
        File cache = tmp.newFolder("cache");
        File updates = new File(cache, "updates");
        File apk = touch(new File(updates, "SentryFi-update.apk"));
        File part = touch(new File(updates, "SentryFi-update.apk.part"));
        File foreign = touch(new File(updates, "notes.txt"));
        File sibling = touch(new File(cache, "SentryFi-update.apk"));          // outside updates/
        File nestedDir = new File(updates, "SentryFi-update-dir");
        File nested = touch(new File(nestedDir, "SentryFi-update.apk"));       // in a subfolder
        File outside = touch(new File(tmp.getRoot(), "victim.apk"));
        File link = new File(updates, "SentryFi-update-link.apk");
        boolean haveLink;
        try {
            Files.createSymbolicLink(link.toPath(), outside.toPath());
            haveLink = true;
        } catch (UnsupportedOperationException | IOException e) {
            haveLink = false;
        }

        assertEquals(2, ApkUpdateChecks.ownCacheFiles(updates).size());
        assertFalse(ApkUpdateChecks.isDeletableCacheFile(updates, sibling));
        assertFalse(ApkUpdateChecks.isDeletableCacheFile(updates, nested));
        assertFalse(ApkUpdateChecks.isDeletableCacheFile(updates, nestedDir));
        assertFalse(ApkUpdateChecks.isDeletableCacheFile(updates, new File(updates, "../SentryFi-update.apk")));
        if (haveLink) assertFalse(ApkUpdateChecks.isDeletableCacheFile(updates, link));

        assertEquals(2, ApkUpdateChecks.deleteOwnCacheFiles(updates));
        assertFalse(apk.exists());
        assertFalse(part.exists());
        assertTrue(foreign.exists());
        assertTrue(sibling.exists());
        assertTrue(nested.exists());
        assertTrue(outside.exists());

        // Explicit lists are re-checked too.
        assertEquals(0, ApkUpdateChecks.deleteOwnCacheFiles(updates, Arrays.asList(sibling, nested, outside, foreign)));
        assertTrue(sibling.exists() && nested.exists() && outside.exists() && foreign.exists());
    }

    @Test public void cleanupToleratesMissingFolder() {
        File missing = new File(tmp.getRoot(), "nope");
        assertEquals(0, ApkUpdateChecks.deleteOwnCacheFiles(missing));
        assertEquals(0, ApkUpdateChecks.deleteOwnCacheFiles(null, Collections.<File>emptyList()));
    }
}
