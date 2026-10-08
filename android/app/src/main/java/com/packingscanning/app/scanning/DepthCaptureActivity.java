package com.packingscanning.app.scanning;

import android.app.AlertDialog;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.ScrollView;
import android.widget.TextView;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Session;
import java.util.Locale;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Guided local depth capture. No background camera, location, cloud anchors or upload. */
public final class DepthCaptureActivity extends ComponentActivity implements CaptureRenderer.Listener {
    private Session session;
    private GLSurfaceView surface;
    private CaptureRenderer renderer;
    private TextView status;
    private Button start, finish;
    private Spinner area;
    private String target;
    private boolean installRequested, scanStarted, completed, saving, reviewing;
    private volatile boolean foreground;
    private volatile boolean destroyed;
    private CaptureScopeManager.Access captureAccess;
    private final Handler privacyTimer=new Handler(Looper.getMainLooper());
    private final Runnable privacyCheck=new Runnable(){public void run(){if(completed||destroyed)return;try{captureAccess.check();privacyTimer.postDelayed(this,1000);}catch(Exception error){fail("The workspace locked. Unlock it before scanning again.");}}};
    private final ExecutorService writer = Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { if (!saving) fail("Scan cancelled."); }
        });
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        target = getIntent().getStringExtra("target");
        try { captureAccess=CaptureRuntime.manager(getFilesDir()).access(getIntent().getStringExtra("captureLease")); }
        catch(Exception error){fail("Select or unlock a capture workspace first.");return;}
        if (!"item".equals(target) && !"container_interior".equals(target)) { fail("Choose an item or bag-interior scan."); return; }
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(0xFF182924);
        FrameLayout preview = new FrameLayout(this);
        surface = new GLSurfaceView(this);
        surface.setEGLContextClientVersion(2); surface.setPreserveEGLContextOnPause(true);
        renderer = new CaptureRenderer("item".equals(target),this);
        surface.setRenderer(renderer);
        preview.addView(surface,new FrameLayout.LayoutParams(-1,-1));

        LinearLayout top = panel();
        Button cancel = button("Cancel scan"); cancel.setOnClickListener(view -> { if (!saving) fail("Scan cancelled."); }); top.addView(cancel);
        TextView instructions = text("item".equals(target)
            ? "Keep one object still and clear of other objects. Aim at its front, then move slowly around it at different heights."
            : "Keep the bag empty and open. Aim at the cavity, then capture its visible walls. Confirm the usable inside and opening manually afterwards.");
        top.addView(instructions);
        TextView privacy = text("This capture uses Google Play Services for AR (ARCore). Learn how it processes data.");
        privacy.setTextColor(Color.rgb(100,230,190)); privacy.setOnClickListener(view -> startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://developers.google.com/ar/develop/privacy-requirements"))));
        top.addView(privacy);
        root.addView(top,new LinearLayout.LayoutParams(-1,-2));

        TextView crosshair = text("+"); crosshair.setTextSize(36); crosshair.setGravity(Gravity.CENTER);
        preview.addView(crosshair,new FrameLayout.LayoutParams(56,56,Gravity.CENTER));
        root.addView(preview,new LinearLayout.LayoutParams(-1,0,1));

        LinearLayout bottom = panel();
        status = text("Starting the camera and checking depth support…"); status.setMaxLines(7); bottom.addView(status);
        TextView areaLabel = text("Capture area · choose enough space for the whole object"); bottom.addView(areaLabel);
        area = new Spinner(this);
        ArrayAdapter<String> choices = new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,new String[] {"60 cm wide · small object","120 cm wide · medium object or bag","200 cm wide · large bag"});
        area.setAdapter(choices); area.setSelection("item".equals(target) ? 0 : 1); bottom.addView(area);
        start = button("Start capture"); start.setEnabled(false); start.setOnClickListener(view -> {
            double halfExtent = new double[] {0.3,0.6,1.0}[area.getSelectedItemPosition()];
            surface.queueEvent(() -> renderer.start(halfExtent)); scanStarted = true; start.setText("Restart capture");
        }); bottom.addView(start);
        finish = button("Review size estimate"); finish.setEnabled(false); finish.setOnClickListener(view -> review()); bottom.addView(finish);
        ScrollView controls = new ScrollView(this); controls.setFillViewport(true); controls.addView(bottom);
        root.addView(controls,new LinearLayout.LayoutParams(-1,(int) (230 * getResources().getDisplayMetrics().density)));
        root.setOnApplyWindowInsetsListener((view,insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom()); return insets;
        });
        setContentView(root);
    }

    private LinearLayout panel() { LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL); panel.setPadding(20,12,20,12); panel.setBackgroundColor(0xD0182924); return panel; }
    private TextView text(String value) { TextView text = new TextView(this); text.setText(value); text.setTextColor(Color.WHITE); text.setTextSize(15); text.setPadding(0,6,0,6); return text; }
    private Button button(String value) { Button button = new Button(this); button.setText(value); button.setMinHeight((int) (48 * getResources().getDisplayMetrics().density)); return button; }

    @Override protected void onResume() {
        super.onResume(); foreground=true;
        if (surface == null || completed) return;
        try {
            captureAccess.check();CaptureRuntime.enterCapture(captureAccess);privacyTimer.removeCallbacks(privacyCheck);privacyTimer.postDelayed(privacyCheck,1000);
            if (session == null) {
                ArCoreApk.InstallStatus install = ArCoreApk.getInstance().requestInstall(this,!installRequested);
                if (install == ArCoreApk.InstallStatus.INSTALL_REQUESTED) { installRequested = true; return; }
                session = new Session(this);
                if (!session.isDepthModeSupported(Config.DepthMode.RAW_DEPTH_ONLY)) {
                    fail("This device does not support raw depth. Use manual measurement instead."); return;
                }
                Config config = session.getConfig(); config.setDepthMode(Config.DepthMode.RAW_DEPTH_ONLY); config.setFocusMode(Config.FocusMode.AUTO); session.configure(config);
            }
            session.resume(); renderer.session(session,getWindowManager().getDefaultDisplay().getRotation()); surface.onResume();
            if(scanStarted&&!saving){reviewing=false;surface.queueEvent(renderer::continueCapture);}
            start.setEnabled(true);
            status.setText(scanStarted ? "Capture resumed. Wait for tracking before continuing." : "Centre the object, choose the capture area, then tap Start capture.");
        } catch (Exception error) { fail("The depth camera could not start. Check ARCore, camera permissions, and device support. " + error.getMessage()); }
    }

    @Override protected void onPause() {
        foreground=false;
        CaptureRuntime.leaveCapture(captureAccess);
        privacyTimer.removeCallbacks(privacyCheck);
        if(!completed&&captureAccess!=null&&captureAccess.protectedWorkspace())try{CaptureRuntime.manager(getFilesDir()).lock(captureAccess.lease());}catch(Exception ignored){ /* Store access still fails closed. */ }
        if (surface != null) surface.onPause();
        if (session != null) session.pause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        CaptureRuntime.leaveCapture(captureAccess);
        privacyTimer.removeCallbacks(privacyCheck);
        if (session != null) { session.close(); session = null; }
        writer.shutdown();
        super.onDestroy();
    }

    @Override public void onUserInteraction(){super.onUserInteraction();if(captureAccess!=null&&!completed)try{captureAccess.touch();}catch(Exception error){fail("The workspace locked. Unlock it before scanning again.");}}

    @Override public void progress(String message, boolean canFinish) {
        runOnUiThread(() -> { if (!completed && !saving && !reviewing) { status.setText(message); finish.setEnabled(scanStarted && canFinish); } });
    }
    @Override public void failure(String message) { runOnUiThread(() -> { status.setText(message); start.setEnabled(false); finish.setEnabled(false); }); }

    private void review() {
        reviewing=true; finish.setEnabled(false); status.setText("Reviewing the estimate…");
        surface.queueEvent(() -> {
            try {
                captureAccess.check();
                if(!foreground||destroyed)throw new IllegalStateException("Capture is no longer in the foreground.");
                DepthCloud.Snapshot snapshot = renderer.finish();
                JSONObject recognition=null;
                if("item".equals(target)&&getIntent().getBooleanExtra("recognize",false)){
                    byte[] input=null;
                    try{input=renderer.recognitionInput();recognition=LocalItemDetector.detect(getAssets(),input);}
                    catch(Exception | LinkageError unavailable){recognition=RecognitionPolicy.unavailable();}
                    finally{if(input!=null)java.util.Arrays.fill(input,(byte)0);}
                }
                final JSONObject suggestion=recognition;
                captureAccess.check();
                runOnUiThread(() -> { if(destroyed||completed||!foreground)return;
                    try{captureAccess.check();}catch(Exception locked){fail("The workspace locked before review.");return;}
                    new AlertDialog.Builder(this).setTitle("Review the size estimate")
                    .setMessage(String.format(Locale.getDefault(),"%.1f × %.1f × %.1f cm\n\n%d depth points from %d angles. Check the green geometry for surrounding objects and missing sides. This is an oriented estimate with a small sampling margin, not a complete solid model. Confirm all dimensions physically before relying on a plan.%s",snapshot.dimensionsMm[0] / 10,snapshot.dimensionsMm[1] / 10,snapshot.dimensionsMm[2] / 10,snapshot.points.size(),snapshot.views,("container_interior".equals(target) ? "\n\nVisible walls do not establish the usable cavity or opening." : "")+(snapshot.guidance.freshFrames>0?"\n\n"+String.join("\n\n",snapshot.guidance.warnings("item".equals(target))):"")))
                    .setPositiveButton("Use estimate",(dialog,which) -> save(snapshot,suggestion))
                    .setNegativeButton("Scan more",(dialog,which) -> { reviewing=false; surface.queueEvent(renderer::continueCapture); })
                    .setOnCancelListener(dialog -> { reviewing=false; surface.queueEvent(renderer::continueCapture); }).show(); });
            } catch (Exception error) { runOnUiThread(() -> { reviewing=false; if(!destroyed&&!completed)status.setText(error.getMessage()); }); }
        });
    }

    private void save(DepthCloud.Snapshot snapshot,JSONObject recognition) {
        if(!foreground||destroyed||completed)return;
        try{captureAccess.check();}catch(Exception locked){fail("The workspace locked before saving.");return;}
        saving = true; start.setEnabled(false); finish.setEnabled(false); status.setText("Saving the point cloud privately on this device…");
        writer.execute(() -> {
            try {
                CaptureStore store = new CaptureStore(getFilesDir(),captureAccess);
                JSONObject result = store.save(target,snapshot);
                // Suggestions are transient: no pixels or predictions are added to saved scan metadata.
                if(recognition!=null)result.put("recognition",recognition);
                String id = result.getJSONObject("record").getString("id");
                if (destroyed) { store.delete(id); return; }
                runOnUiThread(() -> {
                    if (destroyed || isFinishing()) {
                        new Thread(() -> { try { store.delete(id); } catch (Exception ignored) { /* A failed cleanup remains private and can be cleared from Settings. */ } }).start();
                        return;
                    }
                    try{captureAccess.check();completed = true; setResult(RESULT_OK,new Intent().putExtra("result",result.toString())); finish();}
                    catch(Exception error){fail("The workspace locked before the estimate returned. Unlock it before scanning again.");}
                });
            } catch (Exception error) { runOnUiThread(() -> { saving = false; start.setEnabled(true); status.setText("The capture could not be saved. Restart or cancel. " + error.getMessage()); }); }
        });
    }

    private void fail(String reason) { completed = true; setResult(RESULT_CANCELED,new Intent().putExtra("error",reason)); finish(); }
}
