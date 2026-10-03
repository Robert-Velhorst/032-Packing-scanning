package com.packingscanning.app;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.hardware.camera2.*;
import android.hardware.display.DisplayManager;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.*;
import android.os.*;
import android.util.Size;
import android.view.*;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import androidx.activity.OnBackPressedCallback;
import com.packingscanning.app.files.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.util.*;

/** Camera2 JPEG stays in RAM until the encrypted draft store accepts it; no public/temporary image file. */
public final class ReferencePhotoActivity extends AppCompatActivity {
    private TextureView view;private FrameLayout previewFrame;private TextView status;private Button shutter;
    private HandlerThread thread;private Handler handler;private CameraDevice camera;private CameraCaptureSession session;private ImageReader reader;
    private volatile Size previewBuffer;private DisplayManager displays;
    private final DisplayManager.DisplayListener displayListener=new DisplayManager.DisplayListener(){public void onDisplayAdded(int id){}public void onDisplayRemoved(int id){}public void onDisplayChanged(int id){transformPreview();}};
    private Surface previewSurface;private String request;private PendingItemPhotoStore store;
    private volatile boolean resumed,finished,taking;private final java.util.concurrent.atomic.AtomicBoolean opening=new java.util.concurrent.atomic.AtomicBoolean();private volatile int epoch;private int sensor;private boolean front;
    @Override protected void onCreate(Bundle state){super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        request=getIntent().getStringExtra("photoRequest");try{store=ItemPhotoRuntime.store(getCacheDir());store.checkRequest(request);}catch(IOException error){finish();return;}
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(16,16,16,16);root.setBackgroundColor(0xff182924);
        status=new TextView(this);status.setTextColor(0xffffffff);status.setTextSize(16);status.setText("Reference photo • saving the item remains your choice. Your protected workspace stays locked.");root.addView(status);
        view=new TextureView(this);view.setContentDescription("Reference photo camera preview");previewFrame=new FrameLayout(this);previewFrame.addView(view,new FrameLayout.LayoutParams(-1,-1,Gravity.CENTER));root.addView(previewFrame,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout controls=new LinearLayout(this);shutter=new Button(this);shutter.setText("Take reference photo");shutter.setEnabled(false);shutter.setOnClickListener(v->take());Button cancel=new Button(this);cancel.setText("Cancel photo");cancel.setOnClickListener(v->finish());controls.addView(shutter,new LinearLayout.LayoutParams(0,-2,1));controls.addView(cancel,new LinearLayout.LayoutParams(0,-2,1));root.addView(controls);setContentView(root);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){finish();}});
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable(){@Override public void run(){if(isFinishing()||isDestroyed())return;try{if(!taking)store.checkRequest(request);}catch(IOException error){finish();return;}new Handler(Looper.getMainLooper()).postDelayed(this,1000);}},1000);
        thread=new HandlerThread("reference-photo-camera");thread.start();handler=new Handler(thread.getLooper());
        view.setSurfaceTextureListener(new TextureView.SurfaceTextureListener(){public void onSurfaceTextureAvailable(SurfaceTexture texture,int width,int height){open();}public void onSurfaceTextureSizeChanged(SurfaceTexture texture,int width,int height){transformPreview();}public boolean onSurfaceTextureDestroyed(SurfaceTexture texture){closeCamera();return true;}public void onSurfaceTextureUpdated(SurfaceTexture texture){}});
    }
    @Override protected void onResume(){super.onResume();resumed=true;displays=(DisplayManager)getSystemService(Context.DISPLAY_SERVICE);if(displays!=null)displays.registerDisplayListener(displayListener,new Handler(Looper.getMainLooper()));if(view!=null&&view.isAvailable())open();}
    @Override protected void onPause(){resumed=false;if(displays!=null)displays.unregisterDisplayListener(displayListener);closeCamera();super.onPause();}
    @Override protected void onStop(){super.onStop();if(!finished&&!isChangingConfigurations())finish();}
    @Override protected void onDestroy(){closeCamera();if(thread!=null)thread.quitSafely();super.onDestroy();}
    private void open(){if(!resumed||camera!=null||handler==null||!opening.compareAndSet(false,true))return;final int openingEpoch=epoch;
        if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){failed("Camera permission is required. Cancel to resume your saved draft.");return;}
        handler.post(()->{synchronized(ReferencePhotoActivity.this){try{
            if(!resumed||openingEpoch!=epoch)return;store.checkRequest(request);CameraManager manager=(CameraManager)getSystemService(Context.CAMERA_SERVICE);String selected=null;CameraCharacteristics characteristics=null;
            for(String id:manager.getCameraIdList()){CameraCharacteristics candidate=manager.getCameraCharacteristics(id);Integer facing=candidate.get(CameraCharacteristics.LENS_FACING);if(selected==null||Objects.equals(facing,CameraCharacteristics.LENS_FACING_BACK)){selected=id;characteristics=candidate;if(Objects.equals(facing,CameraCharacteristics.LENS_FACING_BACK))break;}}
            if(selected==null||characteristics==null)throw new IOException();front=Objects.equals(characteristics.get(CameraCharacteristics.LENS_FACING),CameraCharacteristics.LENS_FACING_FRONT);Integer orientation=characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION);sensor=orientation==null?0:orientation;
            StreamConfigurationMap map=characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);if(map==null)throw new IOException();Size[] jpeg=map.getOutputSizes(ImageFormat.JPEG);if(jpeg==null)throw new IOException();int[][] sizes=new int[jpeg.length][2];for(int i=0;i<jpeg.length;i++)sizes[i]=new int[]{jpeg[i].getWidth(),jpeg[i].getHeight()};Size size=jpeg[ReferenceCameraPolicy.chooseSize(sizes)];
            reader=ImageReader.newInstance(size.getWidth(),size.getHeight(),ImageFormat.JPEG,2);reader.setOnImageAvailableListener(this::imageReady,handler);
            Size[] preview=map.getOutputSizes(SurfaceTexture.class);if(preview==null||preview.length==0)throw new IOException();Size buffer=preview[0];for(Size candidate:preview)if(candidate.getWidth()<=1920&&candidate.getHeight()<=1080){buffer=candidate;break;}
            SurfaceTexture texture=view.getSurfaceTexture();if(texture==null||!resumed)throw new IOException();texture.setDefaultBufferSize(buffer.getWidth(),buffer.getHeight());previewBuffer=buffer;runOnUiThread(()->{if(resumed&&openingEpoch==epoch)transformPreview();});previewSurface=new Surface(texture);
            if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)throw new SecurityException();manager.openCamera(selected,new CameraDevice.StateCallback(){@Override public void onOpened(CameraDevice device){synchronized(ReferencePhotoActivity.this){if(!resumed||openingEpoch!=epoch||isFinishing()){device.close();return;}opening.set(false);camera=device;configure();}}@Override public void onDisconnected(CameraDevice device){device.close();if(openingEpoch!=epoch)return;opening.set(false);if(camera==device)camera=null;failed("Camera disconnected. Cancel to resume the item draft.");}@Override public void onError(CameraDevice device,int code){device.close();if(openingEpoch!=epoch)return;opening.set(false);if(camera==device)camera=null;failed("The camera is unavailable. Cancel to resume the item draft.");}},handler);
        }catch(Exception error){if(openingEpoch==epoch)opening.set(false);failed("The camera could not open. Cancel to resume your encrypted draft or choose an existing photo.");}}});
    }
    /** TextureView handles sensor orientation; undo its stretch, fit uniformly, then compensate display rotation. */
    private void transformPreview(){
        Size buffer=previewBuffer;if(!resumed||view==null||buffer==null||view.getWidth()<=0||view.getHeight()<=0)return;
        int display=getWindowManager().getDefaultDisplay().getRotation()*90;
        float[] scale=ReferenceCameraPolicy.previewScale(buffer.getWidth(),buffer.getHeight(),view.getWidth(),view.getHeight(),sensor,display);
        float x=view.getWidth()/2f,y=view.getHeight()/2f;Matrix matrix=new Matrix();matrix.setScale(scale[0],scale[1],x,y);matrix.postRotate(-display,x,y);view.setTransform(matrix);
    }
    private void configure(){try{CameraDevice device=camera;ImageReader current=reader;Surface surface=previewSurface;if(device==null||current==null||surface==null)throw new IOException();
        device.createCaptureSession(Arrays.asList(surface,current.getSurface()),new CameraCaptureSession.StateCallback(){@Override public void onConfigured(CameraCaptureSession configured){synchronized(ReferencePhotoActivity.this){if(!resumed||camera!=device){configured.close();return;}session=configured;try{CaptureRequest.Builder preview=device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);preview.addTarget(surface);preview.set(CaptureRequest.CONTROL_MODE,CaptureRequest.CONTROL_MODE_AUTO);configured.setRepeatingRequest(preview.build(),null,handler);runOnUiThread(()->{if(resumed)shutter.setEnabled(true);});}catch(Exception error){failed("Camera preview failed. Cancel to resume the draft.");}}}@Override public void onConfigureFailed(CameraCaptureSession configured){configured.close();if(!resumed||camera!=device)return;failed("Camera preview is unavailable. Cancel to resume the draft.");}},handler);
    }catch(Exception error){failed("Camera setup failed. Cancel to resume the draft.");}}
    private void take(){if(taking||!resumed)return;taking=true;shutter.setEnabled(false);new Handler(Looper.getMainLooper()).postDelayed(()->{if(taking&&!finished&&!isFinishing())finish();},15000);handler.post(()->{try{
        store.checkRequest(request);CameraDevice device=camera;CameraCaptureSession current=session;ImageReader output=reader;if(device==null||current==null||output==null||!resumed)throw new IOException();CaptureRequest.Builder photo=device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);photo.addTarget(output.getSurface());photo.set(CaptureRequest.CONTROL_MODE,CaptureRequest.CONTROL_MODE_AUTO);photo.set(CaptureRequest.JPEG_ORIENTATION,ReferenceCameraPolicy.jpegOrientation(sensor,getWindowManager().getDefaultDisplay().getRotation()*90,front));photo.set(CaptureRequest.JPEG_QUALITY,(byte)90);current.capture(photo.build(),new CameraCaptureSession.CaptureCallback(){@Override public void onCaptureFailed(CameraCaptureSession session,CaptureRequest request,CaptureFailure failure){failed("Photo capture failed. Cancel to resume the draft.");}},handler);
    }catch(Exception error){failed("Photo capture failed. Cancel to resume the draft.");}});}
    private void imageReady(ImageReader source){byte[] bytes=null;try(Image image=source.acquireLatestImage()){
        if(image==null||!resumed||isFinishing())return;ByteBuffer buffer=image.getPlanes()[0].getBuffer();if(buffer.remaining()>PendingItemPhotoStore.MAX_PHOTO_BYTES)throw new IOException();bytes=new byte[buffer.remaining()];buffer.get(bytes);
        PendingItemPhotoStore.Receipt receipt=store.complete(request,new ByteArrayInputStream(bytes));runOnUiThread(()->{finished=true;setResult(RESULT_OK,new Intent().putExtra("photoTicket",receipt.ticket));finish();});
    }catch(Exception error){failed("The photo could not be prepared. Cancel to resume your encrypted draft.");}finally{if(bytes!=null)Arrays.fill(bytes,(byte)0);}}
    private void failed(String message){runOnUiThread(()->{if(status!=null)status.setText(message);if(shutter!=null)shutter.setEnabled(false);});}
    private synchronized void closeCamera(){epoch++;opening.set(false);previewBuffer=null;CameraCaptureSession old=session;session=null;if(old!=null)old.close();CameraDevice device=camera;camera=null;if(device!=null)device.close();ImageReader image=reader;reader=null;if(image!=null)image.close();Surface surface=previewSurface;previewSurface=null;if(surface!=null)surface.release();}
}
