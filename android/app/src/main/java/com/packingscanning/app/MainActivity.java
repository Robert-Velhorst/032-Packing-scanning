package com.packingscanning.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(PackingScanPlugin.class);
        registerPlugin(PackingVoicePlugin.class);
        registerPlugin(PackingPrintPlugin.class);
        registerPlugin(PackingAccountPlugin.class);
        registerPlugin(PackingFilesPlugin.class);
        registerPlugin(PackingPhotoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
