package com.packingscanning.app.accounts;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Private encrypted record bound to the configured origin; key material stays in AndroidKeyStore. */
public final class AccountCredentialStore implements AccountTransport.CredentialStore {
    private static final String ALIAS = "packing-account-session-v1";
    private final SharedPreferences preferences;
    private final byte[] aad;
    public AccountCredentialStore(Context context, String origin) {
        preferences = context.getSharedPreferences("packing-account-session", Context.MODE_PRIVATE);
        aad = ("packing-account-v1\n" + AccountTransport.validateOrigin(origin)).getBytes(StandardCharsets.UTF_8);
    }
    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        SecretKey key = (SecretKey) store.getKey(ALIAS, null);
        if (key != null || !create) return key;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    @Override public AccountTransport.Session read() throws Exception {
        String record = preferences.getString("sealed", null);
        if (record == null) return null;
        if (record.length() > 2048) throw new IllegalStateException("Invalid encrypted session");
        byte[] sealed = Base64.decode(record, Base64.NO_WRAP), plain = null;
        try {
            SecretKey key = key(false);
            if (key == null || sealed.length < 29) throw new IllegalStateException("Unavailable encrypted session");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, sealed, 0, 12)); cipher.updateAAD(aad);
            plain = cipher.doFinal(sealed, 12, sealed.length - 12);
            String[] parts = new String(plain, StandardCharsets.UTF_8).split("\n", -1);
            if (parts.length != 2) throw new IllegalStateException("Invalid session record");
            return new AccountTransport.Session(parts[0], Long.parseLong(parts[1]));
        } finally { if (plain != null) Arrays.fill(plain, (byte)0); Arrays.fill(sealed, (byte)0); }
    }
    @Override public void write(AccountTransport.Session session) throws Exception {
        byte[] plain = (session.token + "\n" + session.expiresAt).getBytes(StandardCharsets.UTF_8);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(true)); cipher.updateAAD(aad);
            byte[] encrypted = cipher.doFinal(plain), iv = cipher.getIV(), sealed = new byte[iv.length + encrypted.length];
            if (iv.length != 12) throw new IllegalStateException("Unsupported session cipher");
            System.arraycopy(iv, 0, sealed, 0, iv.length); System.arraycopy(encrypted, 0, sealed, iv.length, encrypted.length);
            if (!preferences.edit().putString("sealed", Base64.encodeToString(sealed, Base64.NO_WRAP)).commit()) throw new IllegalStateException("Session could not be saved");
        } finally { Arrays.fill(plain, (byte)0); }
    }
    @Override public void clear() throws Exception {
        if (!preferences.edit().remove("sealed").commit()) throw new IllegalStateException("Session could not be removed");
    }
}
