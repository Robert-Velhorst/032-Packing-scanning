package com.packingscanning.app.accounts;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Fixed-origin account transport. No WebView cookies, redirects, caller URLs or headers. */
public final class AccountTransport {
    public static final int MAX_REQUEST = 16 * 1024 * 1024 + 65536;
    public static final int MAX_RESPONSE = 32 * 1024 * 1024;
    private static final String COOKIE = "__Host-packing_session";
    private static final String UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
    public interface CredentialStore {
        Session read() throws Exception;
        void write(Session session) throws Exception;
        void clear() throws Exception;
    }
    public static final class Session {
        public final String token;
        public final long expiresAt;
        public Session(String token, long expiresAt) {
            if (token == null || !token.matches("[A-Za-z0-9_-]{43}") || expiresAt <= 0) throw new IllegalArgumentException("Invalid session record");
            this.token = token; this.expiresAt = expiresAt;
        }
    }
    public static final class Result {
        public final int status;
        public final String json;
        Result(int status, String json) { this.status = status; this.json = json; }
    }
    private final String origin;
    private final CredentialStore credentials;
    private volatile HttpsURLConnection active;
    private volatile boolean closed;
    public AccountTransport(String origin, CredentialStore credentials) {
        this.origin = validateOrigin(origin); this.credentials = credentials;
    }
    public static String validateOrigin(String value) {
        try {
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || !uri.getRawPath().isEmpty() || uri.getPort() == 0 || uri.getPort() > 65535 || !value.equals("https://" + uri.getRawAuthority())) throw new IllegalArgumentException();
            return value;
        } catch (Exception error) { throw new IllegalArgumentException("Accounts require an exact HTTPS origin"); }
    }
    public static boolean allowed(String path, String method) {
        if (path == null || method == null) return false;
        switch (path) {
            case "/session": return method.equals("GET") || method.equals("DELETE");
            case "/sessions": return method.equals("POST") || method.equals("DELETE");
            case "/registrations": case "/recovery": case "/password": return method.equals("POST");
            case "/vault": return method.equals("GET") || method.equals("PUT");
            case "/vault/backup": case "/export": return method.equals("GET");
            case "": return method.equals("DELETE");
            case "/households": return method.equals("GET") || method.equals("POST");
            case "/households/memberships": return method.equals("POST");
            default:
                if (path.matches("/households/" + UUID)) return method.equals("GET") || method.equals("DELETE");
                if (path.matches("/households/" + UUID + "/(ownership|invitations)")) return method.equals("POST");
                if (path.matches("/households/" + UUID + "/(members|invitations)/" + UUID)) return method.equals("DELETE");
                if (path.matches("/households/" + UUID + "/packs")) return method.equals("GET") || method.equals("POST");
                if (path.matches("/households/" + UUID + "/packs/" + UUID)) return method.equals("GET") || method.equals("PUT") || method.equals("DELETE");
                return false;
        }
    }
    public static Session parseCookie(String header, long now) throws IOException {
        String[] parts = header.split(";", -1);
        if (!parts[0].startsWith(COOKIE + "=")) throw new IOException("Unsupported session cookie");
        String token = parts[0].substring(COOKIE.length() + 1);
        Map<String,String> attributes = new HashMap<>();
        for (int i = 1; i < parts.length; i++) {
            String[] attribute = parts[i].trim().split("=", 2);
            String key = attribute[0].toLowerCase(Locale.ROOT);
            if (!java.util.Arrays.asList("path", "secure", "httponly", "samesite", "max-age").contains(key) || attributes.put(key, attribute.length == 2 ? attribute[1] : "") != null) throw new IOException("Unsupported session cookie policy");
        }
        if (!"/".equals(attributes.get("path")) || !"".equals(attributes.get("secure")) || !"".equals(attributes.get("httponly")) || !"Strict".equals(attributes.get("samesite"))) throw new IOException("Unsafe session cookie policy");
        long age;
        try { age = Long.parseLong(attributes.get("max-age")); } catch (Exception error) { throw new IOException("Missing session expiry"); }
        if (age == 0 && token.isEmpty()) return null;
        if (age <= 0 || age > 43200 || !token.matches("[A-Za-z0-9_-]{43}")) throw new IOException("Invalid session cookie");
        return new Session(token, now + age * 1000);
    }
    public synchronized void forget() throws Exception { credentials.clear(); }
    public void close() { closed = true; HttpsURLConnection connection = active; if (connection != null) connection.disconnect(); }
    public synchronized Result request(String path, String method, String body, String csrf) throws Exception {
        if (closed) throw new IOException("Account transport closed");
        // URLConnection consults the process-wide cookie handler. Refuse an ambient cookie jar.
        if (java.net.CookieHandler.getDefault() != null) throw new IOException("Ambient cookie storage refused");
        if (!allowed(path, method) || "GET".equals(method) && body != null || csrf != null && !csrf.matches("[a-f0-9]{64}")) throw new IOException("Unsupported account request");
        byte[] bytes = body == null ? null : body.getBytes(StandardCharsets.UTF_8);
        int maximum = path.equals("/vault") || path.matches("/households/" + UUID + "/packs(?:/" + UUID + ")?") ? MAX_REQUEST : 16384;
        if (bytes != null) {
            if (bytes.length > maximum) throw new IOException("Account request too large");
            jsonObject(body); // Only JSON objects, never a raw upload or GET body.
        }
        HttpsURLConnection connection = (HttpsURLConnection) new URI(origin + "/api/v1/account" + path).toURL().openConnection();
        active = connection;
        long deadline = System.nanoTime() + 30_000_000_000L;
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10000); connection.setReadTimeout(20000);
            connection.setUseCaches(false); connection.setRequestMethod(method);
            connection.setRequestProperty("Origin", origin);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cache-Control", "no-store");
            Session session = credentials.read();
            if (session != null && session.expiresAt <= System.currentTimeMillis()) { credentials.clear(); session = null; }
            if (session != null) connection.setRequestProperty("Cookie", COOKIE + "=" + session.token);
            if (csrf != null) connection.setRequestProperty("X-Packing-CSRF", csrf);
            if (bytes != null) {
                connection.setDoOutput(true); connection.setFixedLengthStreamingMode(bytes.length);
                connection.setRequestProperty("Content-Type", "application/json");
                try (java.io.OutputStream stream = connection.getOutputStream()) { stream.write(bytes); }
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300 && status < 400 || status > 599) throw new IOException("Account redirect or unsupported status refused");
            String json = "";
            if (status != 204) {
                String type = connection.getContentType();
                if (type == null || !type.split(";", 2)[0].trim().equalsIgnoreCase("application/json") || connection.getContentLengthLong() > MAX_RESPONSE) throw new IOException("Unsupported account response");
                try (InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (stream == null) throw new IOException("Missing account response");
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = stream.read(buffer)) != -1) {
                        if (output.size() + count > MAX_RESPONSE || closed || System.nanoTime() > deadline) throw new IOException("Account response exceeded limit");
                        output.write(buffer, 0, count);
                    }
                    json = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString();
                }
                JSONObject envelope = jsonObject(json);
                if (status < 300 ? !envelope.has("data") : !(envelope.opt("error") instanceof JSONObject)) throw new IOException("Unsupported account envelope");
            }
            // Commit cookies only after the entire response passed validation. Never expose them to JS.
            Session replacement = null; boolean hasCookie = false;
            for (Map.Entry<String,List<String>> entry : connection.getHeaderFields().entrySet()) {
                if (entry.getKey() == null || !entry.getKey().equalsIgnoreCase("Set-Cookie")) continue;
                for (String header : entry.getValue()) {
                    if (!header.startsWith(COOKIE + "=")) continue;
                    if (hasCookie) throw new IOException("Ambiguous session cookie");
                    replacement = parseCookie(header, System.currentTimeMillis()); hasCookie = true;
                }
            }
            if (closed) throw new IOException("Account transport closed");
            boolean anonymous = path.equals("/session") && method.equals("GET") && status == 200 && new JSONObject(json).getJSONObject("data").isNull("profile");
            if (status == 401 || anonymous || hasCookie && replacement == null) credentials.clear();
            else if (hasCookie && status < 300) credentials.write(replacement);
            return new Result(status, json);
        } finally { connection.disconnect(); active = null; }
    }
    private static JSONObject jsonObject(String text) throws Exception {
        JSONTokener input = new JSONTokener(text);
        JSONObject value = new JSONObject(input);
        if (input.nextClean() != 0) throw new IOException("Trailing account JSON");
        return value;
    }
}
