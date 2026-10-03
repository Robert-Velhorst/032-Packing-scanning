package com.packingscanning.app.scanning;

import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.Matrix;
import com.google.ar.core.Coordinates2d;
import com.google.ar.core.Frame;
import com.google.ar.core.Pose;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

final class CaptureRenderer implements GLSurfaceView.Renderer {
    interface Listener { void progress(String message, boolean canFinish); void failure(String message); }
    private final Listener listener;
    private final RawDepthSampler sampler;
    private volatile Session session;
    private boolean capturing;
    private Frame latestFrame;
    private double halfExtent;
    private int width, height, rotation, texture, backgroundProgram, pointsProgram;
    private long lastNotification;
    private final FloatBuffer quad = floats(new float[] {-1,-1,1,-1,-1,1,1,1});
    private final FloatBuffer uv = floats(new float[8]);
    private final float[] projection = new float[16], view = new float[16], model = new float[16], pv = new float[16], mvp = new float[16];

    CaptureRenderer(boolean removeSupportPlane, Listener listener) { this.sampler = new RawDepthSampler(removeSupportPlane); this.listener = listener; }
    void session(Session session, int rotation) { this.session = session; this.rotation = rotation; }
    void start(double halfExtent) { sampler.start(); this.halfExtent = halfExtent; capturing = true; }
    DepthCloud.Snapshot finish() { if(latestFrame==null||latestFrame.getCamera().getTrackingState()!=TrackingState.TRACKING)throw new IllegalStateException("Tracking paused. Wait for tracking before reviewing the size estimate."); DepthCloud cloud = sampler.cloud(); if (cloud == null) throw new IllegalStateException("No depth was captured. Aim at the object and move slowly."); DepthCloud.Snapshot result = cloud.snapshot(); capturing = false; return result; }
    void continueCapture() { capturing = true; }
    /** Called on the GL thread before its next Session.update(). Image ownership ends before inference. */
    byte[] recognitionInput() throws Exception {
        Frame frame=latestFrame;
        if(frame==null||width<1||height<1||frame.getCamera().getTrackingState()!=TrackingState.TRACKING)throw new IllegalStateException("Recognition frame unavailable.");
        float span=Math.min(width,height)*0.85f;
        float left=0.5f-span/(2*width),top=0.5f-span/(2*height),right=1-left,bottom=1-top;
        float[] corners=new float[6];java.util.Arrays.fill(corners,Float.NaN);
        frame.transformCoordinates2d(Coordinates2d.VIEW_NORMALIZED,new float[]{left,top,right,top,left,bottom},Coordinates2d.IMAGE_PIXELS,corners);
        try(android.media.Image image=frame.acquireCameraImage()){
            if(image.getFormat()!=android.graphics.ImageFormat.YUV_420_888||image.getPlanes().length!=3||!image.getCropRect().equals(new android.graphics.Rect(0,0,image.getWidth(),image.getHeight())))throw new IllegalStateException("Unsupported camera image.");
            android.media.Image.Plane[] p=image.getPlanes();
            return YuvRgbInput.sample(new ByteBuffer[]{p[0].getBuffer(),p[1].getBuffer(),p[2].getBuffer()},new int[]{p[0].getRowStride(),p[1].getRowStride(),p[2].getRowStride()},new int[]{p[0].getPixelStride(),p[1].getPixelStride(),p[2].getPixelStride()},image.getWidth(),image.getHeight(),corners,LocalItemDetector.SIZE);
        }finally{java.util.Arrays.fill(corners,0);}
    }
    void close() { capturing = false; sampler.close(); session = null; latestFrame=null; }

    @Override public void onSurfaceCreated(GL10 unused, EGLConfig config) {
        int[] textures = new int[1]; GLES20.glGenTextures(1,textures,0); texture = textures[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,texture);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MIN_FILTER,GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MAG_FILTER,GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_S,GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_T,GLES20.GL_CLAMP_TO_EDGE);
        backgroundProgram = program("attribute vec2 position; attribute vec2 uv; varying vec2 tex; void main(){gl_Position=vec4(position,0.,1.);tex=uv;}",
            "#extension GL_OES_EGL_image_external : require\nprecision mediump float; varying vec2 tex; uniform samplerExternalOES camera; void main(){gl_FragColor=texture2D(camera,tex);}");
        pointsProgram = program("attribute vec3 position; uniform mat4 mvp; void main(){gl_Position=mvp*vec4(position,1.);gl_PointSize=4.;}",
            "precision mediump float; void main(){gl_FragColor=vec4(.15,.9,.6,1.);}");
    }

    @Override public void onSurfaceChanged(GL10 unused, int width, int height) { this.width = width; this.height = height; GLES20.glViewport(0,0,width,height); }

    @Override public void onDrawFrame(GL10 unused) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
        Session current = session;
        if (current == null || texture == 0) return;
        try {
            current.setDisplayGeometry(rotation,width,height);
            current.setCameraTextureName(texture);
            Frame frame = current.update(); latestFrame=frame;
            if (frame.getTimestamp() == 0) return;
            quad.position(0); uv.position(0);
            frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,quad,Coordinates2d.TEXTURE_NORMALIZED,uv);
            GLES20.glDisable(GLES20.GL_DEPTH_TEST);
            GLES20.glUseProgram(backgroundProgram);
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0); GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,texture);
            GLES20.glUniform1i(GLES20.glGetUniformLocation(backgroundProgram,"camera"),0);
            attribute(backgroundProgram,"position",quad,2); attribute(backgroundProgram,"uv",uv,2);
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP,0,4);
            if (capturing) sampler.sample(current,frame,halfExtent);
            DepthCloud cloud = sampler.cloud();
            Pose pose = sampler.originPose();
            if (cloud != null && pose != null && frame.getCamera().getTrackingState() == TrackingState.TRACKING) {
                frame.getCamera().getProjectionMatrix(projection,0,0.05f,10);
                frame.getCamera().getViewMatrix(view,0); pose.toMatrix(model,0);
                Matrix.multiplyMM(pv,0,projection,0,view,0); Matrix.multiplyMM(mvp,0,pv,0,model,0);
                float[] points = cloud.previewPoints();
                GLES20.glUseProgram(pointsProgram); GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(pointsProgram,"mvp"),1,false,mvp,0);
                attribute(pointsProgram,"position",floats(points),3); GLES20.glDrawArrays(GLES20.GL_POINTS,0,points.length / 3);
            }
            if (System.nanoTime() - lastNotification > 500_000_000L) {
                lastNotification = System.nanoTime();
                boolean ready = false;
                String message = frame.getCamera().getTrackingState() != TrackingState.TRACKING ? "Tracking paused. Improve the light and move slowly."
                    : cloud == null ? "Aim the centre of the camera at the object. Move a little to establish depth."
                    : cloud.pointCount() + " points · " + cloud.viewCount() + " angles. Move around the object; green points show captured surfaces.";
                if (cloud != null) try { cloud.snapshot(); ready = true; } catch (IllegalStateException error) { message += "\n" + error.getMessage(); }
                if(capturing&&frame.getCamera().getTrackingState()==TrackingState.TRACKING)message += "\n"+sampler.guidanceHint();
                listener.progress(message,ready && capturing && frame.getCamera().getTrackingState()==TrackingState.TRACKING);
            }
        } catch (Exception error) { capturing = false; session = null; latestFrame=null; listener.failure("Capture stopped: " + error.getMessage() + ". Return to manual measurements or reopen capture."); }
    }

    private static FloatBuffer floats(float[] values) { FloatBuffer buffer = ByteBuffer.allocateDirect(values.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer(); buffer.put(values).position(0); return buffer; }
    private static void attribute(int program, String name, FloatBuffer values, int size) { int id = GLES20.glGetAttribLocation(program,name); values.position(0); GLES20.glEnableVertexAttribArray(id); GLES20.glVertexAttribPointer(id,size,GLES20.GL_FLOAT,false,0,values); }
    private static int shader(int type, String source) { int shader = GLES20.glCreateShader(type); GLES20.glShaderSource(shader,source); GLES20.glCompileShader(shader); int[] status = new int[1]; GLES20.glGetShaderiv(shader,GLES20.GL_COMPILE_STATUS,status,0); if (status[0] == 0) throw new IllegalStateException(GLES20.glGetShaderInfoLog(shader)); return shader; }
    private static int program(String vertex, String fragment) { int program = GLES20.glCreateProgram(); int vs = shader(GLES20.GL_VERTEX_SHADER,vertex), fs = shader(GLES20.GL_FRAGMENT_SHADER,fragment); GLES20.glAttachShader(program,vs); GLES20.glAttachShader(program,fs); GLES20.glLinkProgram(program); GLES20.glDeleteShader(vs); GLES20.glDeleteShader(fs); int[] status = new int[1]; GLES20.glGetProgramiv(program,GLES20.GL_LINK_STATUS,status,0); if (status[0] == 0) throw new IllegalStateException(GLES20.glGetProgramInfoLog(program)); return program; }
}
