package com.packingscanning.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/** Explicit, foreground-only, on-device command recognition. Never selects a remote recognizer. */
@CapacitorPlugin(name = "PackingVoice", permissions = {
    @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO})
})
public final class PackingVoicePlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PluginCall pending;
    private String activeId;
    private volatile boolean foreground = true;
    private Runnable watchdog;
    private SpeechRecognizer modelInstaller;
    private TextToSpeech reader;
    private PluginCall reading;

    private boolean supported() {
        return Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
    }
    private Intent intent() {
        return new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE,"en-US")
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE,true)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,false)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1);
    }
    private static boolean english(List<String> languages) {
        return languages.stream().anyMatch(language -> "en-US".equalsIgnoreCase(language) || "en".equalsIgnoreCase(language));
    }
    private void availability(PluginCall call, boolean available, boolean downloadable, String message) {
        call.resolve(new JSObject().put("available",available).put("downloadable",downloadable).put("message",message));
    }

    @PluginMethod public void getAvailability(PluginCall call) {
        main.post(() -> {
            if (!supported()) { availability(call,false,false,"This device has no on-device voice recognizer. Use the touch controls."); return; }
            if (Build.VERSION.SDK_INT < 33) {
                availability(call,true,false,"On-device voice is available. English support will be checked when listening starts."); return;
            }
            SpeechRecognizer query;
            try { query = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext()); }
            catch (Exception error) { availability(call,false,false,"Local voice support could not be opened. Use touch controls."); return; }
            AtomicBoolean answered = new AtomicBoolean();
            Runnable timeout = () -> {
                if (answered.compareAndSet(false,true)) { query.destroy(); availability(call,false,false,"Local English voice support could not be checked. Try again or use touch controls."); }
            };
            main.postDelayed(timeout,8000);
            try {
                query.setRecognitionListener(emptyListener());
                query.checkRecognitionSupport(intent(),getContext().getMainExecutor(),new RecognitionSupportCallback() {
                    @Override public void onSupportResult(RecognitionSupport support) {
                        if (!answered.compareAndSet(false,true)) return;
                        main.removeCallbacks(timeout); query.destroy();
                        boolean installed = english(support.getInstalledOnDeviceLanguages());
                        boolean downloadable = english(support.getSupportedOnDeviceLanguages());
                        availability(call,installed,!installed && downloadable,installed ? "On-device English voice is ready."
                            : english(support.getPendingOnDeviceLanguages()) ? "The English speech model is downloading. Enable voice when it finishes."
                            : downloadable ? "The on-device English speech model is not installed. You can request its download below."
                            : "The device has no local English speech model. Use the touch controls.");
                    }
                    @Override public void onError(int error) {
                        if (!answered.compareAndSet(false,true)) return;
                        main.removeCallbacks(timeout); query.destroy(); availability(call,false,false,"Local English voice support could not be checked. Use touch controls or try again.");
                    }
                });
            } catch (Exception error) { timeout.run(); }
        });
    }

    @PluginMethod public void listen(PluginCall call) {
        main.post(() -> {
            String id = call.getString("id");
            if (id == null || !id.matches("[0-9a-fA-F-]{36}")) { call.reject("Invalid voice session."); return; }
            if (!foreground || !supported()) { call.reject("On-device listening is unavailable while this screen is inactive."); return; }
            if (reading != null) { call.reject("Wait until the spoken step finishes before enabling the microphone."); return; }
            close(); activeId = id; pending = call;
            if (getPermissionState("microphone") != PermissionState.GRANTED) requestPermissionForAlias("microphone",call,"microphoneReady");
            else start(call);
        });
    }
    @PermissionCallback private void microphoneReady(PluginCall call) {
        main.post(() -> {
            if (call == null || !call.getString("id","").equals(activeId)) return;
            if (!foreground || getPermissionState("microphone") != PermissionState.GRANTED) {
                event(activeId,"error",null,0,"Microphone permission was not granted. Use touch controls or allow it in Settings.",false);
                close();
            } else start(call);
        });
    }
    private void start(PluginCall call) {
        String id = activeId;
        try {
            if (Build.VERSION.SDK_INT < 31 || !foreground || !supported() || id == null) { close(); return; }
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                private boolean current() { return id.equals(activeId) && foreground; }
                @Override public void onReadyForSpeech(Bundle params) { if (current()) event(id,"ready",null,0,null,false); }
                @Override public void onResults(Bundle results) {
                    if (!current()) return;
                    List<String> transcripts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    float[] confidence = results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
                    if (transcripts != null && !transcripts.isEmpty()) event(id,"result",transcripts.get(0),confidence != null && confidence.length > 0 ? confidence[0] : 0,null,false);
                    event(id,"end",null,0,null,false); close();
                }
                @Override public void onError(int error) {
                    if (!current()) return;
                    boolean recoverable = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
                    event(id,"error",null,0,error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "Microphone permission was revoked. Use touch controls."
                        : error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE || error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ? "The local English speech model is unavailable. Use touch controls."
                        : "On-device voice recognition stopped. Use touch controls or enable voice again.",recoverable);
                    close();
                }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onPartialResults(Bundle partialResults) {}
                @Override public void onEvent(int eventType, Bundle params) {}
            });
            recognizer.startListening(intent()); pending = null; call.resolve();
            watchdog = () -> { if (id.equals(activeId)) { event(id,"error",null,0,"Listening timed out. Preparing another command.",true); close(); } };
            main.postDelayed(watchdog,20000);
        } catch (Exception error) { event(id,"error",null,0,"On-device listening could not start. Use touch controls.",false); close(); }
    }

    @PluginMethod public void stop(PluginCall call) {
        main.post(() -> { if (call.getString("id","").equals(activeId)) close(); call.resolve(); });
    }
    @PluginMethod public void installModel(PluginCall call) {
        main.post(() -> {
            if (!foreground || Build.VERSION.SDK_INT < 33 || !supported()) { call.reject("Local speech model installation is unavailable."); return; }
            if (modelInstaller != null) modelInstaller.destroy();
            SpeechRecognizer installer;
            try { installer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext()); }
            catch (Exception error) { modelInstaller = null; call.reject("The local English model download could not start."); return; }
            modelInstaller = installer;
            try {
                installer.setRecognitionListener(emptyListener()); installer.triggerModelDownload(intent()); call.resolve();
                // Keep the binder alive long enough to dispatch the asynchronous download request.
                main.postDelayed(() -> { if (modelInstaller == installer) { installer.destroy(); modelInstaller = null; } },60000);
            }
            catch (Exception error) { installer.destroy(); modelInstaller = null; call.reject("The local English model download could not start."); }
        });
    }

    @PluginMethod public void readStep(PluginCall call) {
        main.post(() -> {
            String text = call.getString("text");
            if (!foreground || text == null || text.trim().isEmpty() || text.length() > 2000) { call.reject("This step cannot be read aloud. Follow the text on screen."); return; }
            closeReader(); reading = call;
            reader = new TextToSpeech(getContext(),status -> main.post(() -> {
                if (reading != call || reader == null) return;
                if (!foreground || status != TextToSpeech.SUCCESS) { closeReader(); return; }
                Voice local = reader.getVoices() == null ? null : reader.getVoices().stream()
                    .filter(voice -> !voice.isNetworkConnectionRequired() && !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
                        && "en".equals(voice.getLocale().getLanguage())).findFirst().orElse(null);
                if (local == null || reader.setVoice(local) != TextToSpeech.SUCCESS) {
                    call.reject("No installed on-device English reading voice is available. Follow the text or install one in device Settings."); reading = null; closeReader(); return;
                }
                reader.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) {}
                    @Override public void onDone(String id) { main.post(() -> { if (reading == call) { reading = null; call.resolve(); closeReader(); } }); }
                    @Override public void onError(String id) { main.post(() -> { if (reading == call) closeReader(); }); }
                });
                if (reader.speak(text,TextToSpeech.QUEUE_FLUSH,null,"packing-step") == TextToSpeech.ERROR) closeReader();
            }));
        });
    }
    @PluginMethod public void stopReading(PluginCall call) { main.post(() -> { closeReader(); call.resolve(); }); }
    private void closeReader() {
        if (reading != null) { PluginCall previous = reading; reading = null; previous.reject("Reading stopped. Follow the step on screen."); }
        if (reader != null) { TextToSpeech previous = reader; reader = null; previous.stop(); previous.shutdown(); }
    }
    private RecognitionListener emptyListener() {
        return new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onError(int error) {}
            @Override public void onResults(Bundle results) {}
            @Override public void onPartialResults(Bundle partialResults) {}
            @Override public void onEvent(int eventType, Bundle params) {}
        };
    }
    private void event(String id, String kind, String transcript, float confidence, String message, boolean recoverable) {
        JSObject result = new JSObject().put("id",id).put("kind",kind).put("confidence",confidence).put("recoverable",recoverable);
        if (transcript != null) result.put("transcript",transcript);
        if (message != null) result.put("message",message);
        notifyListeners("voiceEvent",result);
    }
    private void close() {
        activeId = null;
        if (watchdog != null) main.removeCallbacks(watchdog);
        watchdog = null;
        if (pending != null) { pending.reject("Voice listening cancelled. Check permission or enable voice again."); pending = null; }
        if (recognizer != null) { SpeechRecognizer previous = recognizer; recognizer = null; previous.cancel(); previous.destroy(); }
    }
    @Override protected void handleOnResume() { foreground = true; }
    @Override protected void handleOnPause() { foreground = false; main.post(() -> { if (activeId != null) event(activeId,"error",null,0,"Microphone off while the app is in the background. Enable voice to continue.",false); close(); closeReader(); }); }
    @Override protected void handleOnDestroy() { foreground = false; main.post(() -> { close(); closeReader(); if (modelInstaller != null) { modelInstaller.destroy(); modelInstaller = null; } }); }
}
