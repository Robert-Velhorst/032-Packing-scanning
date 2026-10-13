package com.packingscanning.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintJob;
import android.print.PrintManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** User-requested system print dialog. The title never contains trip or inventory data. */
@CapacitorPlugin(name = "PackingPrint")
public final class PackingPrintPlugin extends Plugin {
    private PrintJob activeJob;
    private volatile boolean foreground = true;

    @PluginMethod public void printSequence(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!foreground || getActivity().isFinishing() || getActivity().isDestroyed()) { call.reject("Return to the packing sequence before printing."); return; }
            if (activeJob != null && !activeJob.isCompleted() && !activeJob.isCancelled() && !activeJob.isFailed()) {
                call.reject("Finish or cancel the current print request before starting another."); return;
            }
            PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            if (manager == null) { call.reject("This device has no print service. The sequence remains available offline."); return; }
            try {
                activeJob = manager.print("Packing sequence", getBridge().getWebView().createPrintDocumentAdapter("Packing sequence"), new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception error) { call.reject("The print dialog could not open. The sequence remains available offline."); }
        });
    }
    @Override protected void handleOnPause() { foreground = false; }
    @Override protected void handleOnResume() { foreground = true; }
    @Override protected void handleOnDestroy() { foreground = false; }
}
