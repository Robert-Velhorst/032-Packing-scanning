package com.packingscanning.app.scanning;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Runtime-only capture authority. An old store always retains its old, revocable scope. */
public final class CaptureScopeManager {
    public static final long IDLE_TIMEOUT_MS = 5 * 60 * 1000;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final byte[] MAGIC = {'P', 'S', 'C', '1'};
    static final int SEALED_OVERHEAD = 4 + 12 + 16;
    interface Clock { long milliseconds(); }
    interface IoAction<T> { T run() throws IOException; }
    private final File filesDir;
    private final Clock clock;
    private String revision = UUID.randomUUID().toString();
    private Access active;

    public CaptureScopeManager(File filesDir) throws IOException {
        this(filesDir, () -> System.nanoTime() / 1_000_000);
    }

    CaptureScopeManager(File filesDir, Clock clock) throws IOException {
        this.filesDir = filesDir.getCanonicalFile();
        if (!this.filesDir.isDirectory()) throw new IOException("Private app storage is unavailable.");
        this.clock = clock;
    }

    /** Includes the locked state. Callers must supply this revision for a deliberate selection. */
    public synchronized String revision() { expire(); return revision; }

    public static final class State {
        public final String revision, lease;
        public final boolean protectedWorkspace;
        private State(String revision,String lease,boolean protectedWorkspace) { this.revision=revision;this.lease=lease;this.protectedWorkspace=protectedWorkspace; }
    }
    public synchronized State state() { expire();return new State(revision,active==null?null:active.lease,active!=null&&active.protectedWorkspace()); }

    public synchronized Access selectGuest(String expectedRevision) throws IOException {
        requireRevision(expectedRevision);
        Access next = new Access(null, null, null);
        replace(next);
        return next;
    }

    /** The caller borrows its unlocked 256-bit data key; this manager owns an independent copy. */
    public synchronized Access openWorkspace(String expectedRevision, String workspaceId, String accountId, byte[] dataKey) throws IOException {
        requireRevision(expectedRevision);
        String workspace = canonicalId(workspaceId), account = canonicalId(accountId);
        if (dataKey == null || dataKey.length != 32) throw new IOException("A 256-bit workspace key is required.");
        Access next = new Access(workspace, account, dataKey.clone());
        replace(next);
        return next;
    }

    public synchronized Access access(String lease) throws IOException {
        expire();
        if (active == null || !active.lease.equals(lease)) throw new IOException("The capture workspace is locked or has changed.");
        active.check();
        return active;
    }

    /** A late callback from a previous selection cannot lock a newer selection. */
    public synchronized boolean lock(String expectedRevision) {
        expire();
        if (!revision.equals(expectedRevision)) return false;
        revoke();
        return true;
    }

    /** For app/bridge teardown, irrespective of the current selection. */
    public synchronized void lock() { revoke(); }

    private void requireRevision(String expected) throws IOException {
        expire();
        if (!revision.equals(expected)) throw new IOException("The capture workspace changed before selection completed.");
    }

    private void replace(Access next) {
        revoke();
        active = next;
        revision = next.lease;
    }

    private void revoke() {
        if (active != null) {
            if (active.key != null) Arrays.fill(active.key, (byte) 0);
            active.closed = true;
            active = null;
        }
        revision = UUID.randomUUID().toString();
    }

    private void expire() {
        if (active != null && active.key != null && clock.milliseconds() - active.lastInteraction >= IDLE_TIMEOUT_MS) revoke();
    }

    private static String canonicalId(String value) throws IOException {
        if (value == null || !value.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
            throw new IOException("Invalid capture workspace identity.");
        return UUID.fromString(value).toString();
    }

    public final class Access {
        private final String lease = UUID.randomUUID().toString();
        private final String workspace, account;
        private final byte[] key;
        private boolean closed;
        private long lastInteraction = clock.milliseconds();
        private Access(String workspace, String account, byte[] key) { this.workspace = workspace; this.account = account; this.key = key; }
        public String lease() { return lease; }
        public boolean protectedWorkspace() { return workspace != null; }
        /** Public labels only. File operations must still check a current lease. */
        public String workspaceId() { return workspace; }
        public String accountId() { return account; }

        /** Only explicit user interaction renews the idle window; reading/writing files does not. */
        public void touch() throws IOException {
            synchronized (CaptureScopeManager.this) { check(); lastInteraction = clock.milliseconds(); }
        }

        public void check() throws IOException {
            synchronized (CaptureScopeManager.this) {
                expire();
                if (closed || active != this) throw new IOException("The capture workspace is locked or has changed.");
            }
        }

        <T> T checked(IoAction<T> action) throws IOException {
            synchronized (CaptureScopeManager.this) { check(); return action.run(); }
        }

        File root(File requestedFilesDir) throws IOException {
            return checked(() -> {
                if (!filesDir.equals(requestedFilesDir.getCanonicalFile())) throw new IOException("Invalid private capture storage.");
                File parent = child(filesDir, protectedWorkspace() ? "packing-scans-protected" : "packing-scans");
                if (!parent.isDirectory() && !parent.mkdir()) throw new IOException("Capture storage could not be prepared.");
                if (!protectedWorkspace()) return parent;
                File root = child(parent, workspace);
                if (!root.isDirectory() && !root.mkdir()) throw new IOException("Capture storage could not be prepared.");
                return root;
            });
        }

        byte[] seal(String captureId, String name, byte[] plain) throws IOException {
            synchronized (CaptureScopeManager.this) {
                check();
                if (key == null) throw new IOException("Guest files are not encrypted workspace files.");
                byte[] nonce = new byte[12]; RANDOM.nextBytes(nonce);
                byte[] encrypted = crypt(Cipher.ENCRYPT_MODE, captureId, name, nonce, plain, 0, plain.length);
                byte[] output = new byte[MAGIC.length + nonce.length + encrypted.length];
                System.arraycopy(MAGIC, 0, output, 0, MAGIC.length);
                System.arraycopy(nonce, 0, output, MAGIC.length, nonce.length);
                System.arraycopy(encrypted, 0, output, MAGIC.length + nonce.length, encrypted.length);
                return output;
            }
        }

        byte[] unseal(String captureId, String name, byte[] sealed) throws IOException {
            synchronized (CaptureScopeManager.this) {
                check();
                if (key == null || sealed.length < SEALED_OVERHEAD) throw new IOException("Invalid encrypted capture file.");
                for (int i = 0; i < MAGIC.length; i++) if (sealed[i] != MAGIC[i]) throw new IOException("Unsupported encrypted capture format.");
                byte[] nonce = Arrays.copyOfRange(sealed, MAGIC.length, MAGIC.length + 12);
                // Authenticate the entire file before any plaintext is returned to geometry parsing.
                return crypt(Cipher.DECRYPT_MODE, captureId, name, nonce, sealed, MAGIC.length + 12, sealed.length - MAGIC.length - 12);
            }
        }

        private byte[] crypt(int mode, String id, String name, byte[] nonce, byte[] input, int offset, int length) throws IOException {
            canonicalId(id);
            if (!"points.ply".equals(name) && !"capture.json".equals(name)) throw new IOException("Invalid capture file identity.");
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
                cipher.updateAAD(("packing-scanning-native-capture-v1:" + workspace + ":" + account + ":" + UUID.fromString(id) + ":" + name).getBytes(StandardCharsets.UTF_8));
                return cipher.doFinal(input, offset, length);
            } catch (GeneralSecurityException error) { throw new IOException("Encrypted capture authentication failed."); }
        }
    }

    private static File child(File parent, String name) throws IOException {
        File file = new File(parent, name).getCanonicalFile();
        if (!parent.equals(file.getParentFile()) || !name.equals(file.getName())) throw new IOException("Invalid private capture location.");
        return file;
    }
}
