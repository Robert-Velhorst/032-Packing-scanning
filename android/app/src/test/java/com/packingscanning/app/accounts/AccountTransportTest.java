package com.packingscanning.app.accounts;

import java.io.IOException;
import org.junit.Test;
import static org.junit.Assert.*;

public class AccountTransportTest {
    private static final String TOKEN = "a".repeat(43);
    private static final String COOKIE = "__Host-packing_session=" + TOKEN + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure";
    @Test public void arbitraryUrlsQueriesAndMethodsCannotReachTransport() {
        for (String origin : new String[]{"http://localhost", "https://example.com/", "https://user@example.com", "https://example.com?x=1", "https://example.com#x", "https://example.com:0", "https://example.com:99999", "https://example.com/api"}) {
            assertThrows(IllegalArgumentException.class, () -> AccountTransport.validateOrigin(origin));
        }
        assertEquals("https://accounts.example.com", AccountTransport.validateOrigin("https://accounts.example.com"));
        for (String path : new String[]{"https://other.example.com/session", "//other.example.com", "/session?x=1", "/session#x", "/../session", "/%73ession", "/sessions/", "/households/../../export"}) assertFalse(AccountTransport.allowed(path, "GET"));
        assertFalse(AccountTransport.allowed("/vault", "POST")); assertFalse(AccountTransport.allowed("/sessions", "get"));
        assertTrue(AccountTransport.allowed("/vault", "PUT"));
        assertTrue(AccountTransport.allowed("/households/abcdef01-2345-6789-abcd-0123456789ab/packs/abcdef01-2345-6789-abcd-0123456789ab", "PUT"));
    }
    @Test public void sessionCookieRequiresExactHostOnlyPolicyAndBoundedExpiry() throws Exception {
        AccountTransport.Session session = AccountTransport.parseCookie(COOKIE, 1000);
        assertEquals(TOKEN, session.token); assertEquals(43201000L, session.expiresAt);
        assertNull(AccountTransport.parseCookie("__Host-packing_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure", 1000));
        for (String unsafe : new String[]{COOKIE.replace("; Secure", ""), COOKIE.replace("; HttpOnly", ""), COOKIE.replace("Path=/", "Path=/api"), COOKIE + "; Domain=example.com", COOKIE + "; Max-Age=10", COOKIE.replace("Strict", "None"), COOKIE.replace("43200", "43201"), COOKIE.replace("43200", "-1"), COOKIE.replace(TOKEN, "bad\r\nvalue"), COOKIE + "; Unknown=x"}) {
            assertThrows(IOException.class, () -> AccountTransport.parseCookie(unsafe, 1000));
        }
    }
    @Test public void invalidRequestAndClosedTransportNeverReadCredentials() throws Exception {
        AccountTransport transport = new AccountTransport("https://accounts.example.com", new AccountTransport.CredentialStore() {
            public AccountTransport.Session read() { fail("Credentials must not be read"); return null; }
            public void write(AccountTransport.Session s) { fail(); }
            public void clear() { fail(); }
        });
        assertThrows(IOException.class, () -> transport.request("/session", "GET", "{}", null));
        assertThrows(IOException.class, () -> transport.request("/vault", "PUT", "{}", "bad"));
        assertThrows(Exception.class, () -> transport.request("/sessions", "POST", "{}trailing", null));
        assertThrows(IOException.class, () -> transport.request("/sessions", "POST", "{\"x\":\"" + "a".repeat(16384) + "\"}", null));
        transport.close(); assertThrows(IOException.class, () -> transport.request("/session", "GET", null, null));
    }
}
