package com.packingscanning.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import androidx.activity.result.ActivityResult;
import android.app.Activity;
import android.content.Intent;
import java.nio.charset.StandardCharsets;
import com.packingscanning.app.accounts.AccountCredentialStore;
import com.packingscanning.app.accounts.AccountTransport;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(name = "PackingAccount")
public class PackingAccountPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicInteger pending = new AtomicInteger();
    private String origin;
    private AccountTransport transport;
    private boolean exporting;
    @Override public void load() {
        try {
            String value = getConfig().getString("serviceOrigin", "");
            if (!value.isEmpty()) { origin = AccountTransport.validateOrigin(value); transport = new AccountTransport(origin, new AccountCredentialStore(getContext(), origin)); }
        } catch (Exception error) { origin = null; transport = null; }
    }
    @PluginMethod public void getAvailability(PluginCall call) {
        JSObject result = new JSObject(); result.put("configured", transport != null);
        if (origin != null) result.put("serviceOrigin", origin); call.resolve(result);
    }
    private void execute(PluginCall call, boolean forget) {
        if (transport == null) { call.reject("Accounts are not configured on this installation.", "account_unavailable"); return; }
        if (pending.incrementAndGet() > 8) { pending.decrementAndGet(); call.reject("Wait for the current account request.", "account_busy"); return; }
        try { worker.execute(() -> {
            try {
                if (forget) { transport.forget(); call.resolve(); return; }
                AccountTransport.Result response = transport.request(call.getString("path"), call.getString("method", "GET"), call.getString("bodyJson"), call.getString("csrf"));
                JSObject result = new JSObject(); result.put("status", response.status); result.put("bodyJson", response.json); call.resolve(result);
            } catch (Exception error) { call.reject("The account request was not confirmed. Check your connection or forget this device sign-in if its saved session cannot be opened.", "account_unconfirmed"); }
            finally { pending.decrementAndGet(); }
        }); } catch (RejectedExecutionException error) { pending.decrementAndGet(); call.reject("Account access has closed.", "account_unavailable"); }
    }
    @PluginMethod public void request(PluginCall call) { execute(call, false); }
    @PluginMethod public void forgetSession(PluginCall call) { execute(call, true); }
    @PluginMethod public void exportFile(PluginCall call) {
        String name = call.getString("name"), text = call.getString("text");
        if (name == null || !name.matches("packing-(account-(backup|export)\\.json|account-recovery\\.txt|household-invitation\\.txt|household-pack\\.json)") || text == null || text.length() > AccountTransport.MAX_RESPONSE) {
            call.reject("Choose a supported account export.", "invalid_export"); return;
        }
        getActivity().runOnUiThread(() -> {
            if (exporting || getActivity().isFinishing() || getActivity().isDestroyed()) { call.reject("Finish the current file save first.", "export_busy"); return; }
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(name.endsWith(".json") ? "application/json" : "text/plain").putExtra(Intent.EXTRA_TITLE, name);
            exporting = true;
            try { startActivityForResult(call, intent, "fileChosen"); }
            catch (Exception error) { exporting = false; call.reject("The system file-save dialog could not open.", "export_failed"); }
        });
    }
    @ActivityCallback private void fileChosen(PluginCall call, ActivityResult result) {
        exporting = false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { JSObject value = new JSObject(); value.put("saved", false); call.resolve(value); return; }
        try { worker.execute(() -> {
            try {
                String text = call.getString("text");
                if (text == null) throw new IllegalArgumentException();
                byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > AccountTransport.MAX_RESPONSE) throw new IllegalArgumentException();
                try (java.io.OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                    if (stream == null) throw new IllegalStateException(); stream.write(bytes);
                }
                JSObject value = new JSObject(); value.put("saved", true); call.resolve(value);
            } catch (Exception error) { call.reject("The export could not be saved. The selected file may be incomplete; choose another destination and retry.", "export_failed"); }
        }); } catch (RejectedExecutionException error) { call.reject("File saving has closed.", "export_failed"); }
    }
    @Override protected void handleOnDestroy() { if (transport != null) transport.close(); worker.shutdownNow(); super.handleOnDestroy(); }
}
