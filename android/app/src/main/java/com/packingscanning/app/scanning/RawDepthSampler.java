package com.packingscanning.app.scanning;

import android.media.Image;
import com.google.ar.core.Anchor;
import com.google.ar.core.CameraIntrinsics;
import com.google.ar.core.Frame;
import com.google.ar.core.Plane;
import com.google.ar.core.Pose;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.NotYetAvailableException;
import java.util.ArrayList;
import java.util.List;

/** Only fresh raw-depth frames are integrated; each image is closed on every exit path. */
final class RawDepthSampler {
    private static final class SupportPlane {
        final Plane plane;
        final Pose worldToLocal;
        SupportPlane(Plane plane) { this.plane=plane; this.worldToLocal=plane.getCenterPose().inverse(); }
    }
    private Anchor origin;
    private DepthCloud cloud;
    private long lastDepthTimestamp = -1;
    private long lastSampleTime;
    private float[] sampleBuffer = new float[0];
    private final float[] cameraPoint = new float[3], worldPoint = new float[3], relativePoint = new float[3];
    private final float[] localPoint = new float[3], cameraLocal = new float[3];
    private final boolean removeSupportPlane;
    private CaptureGuidance guidance=new CaptureGuidance();
    String guidanceHint(){return guidance.hint(removeSupportPlane);}

    RawDepthSampler(boolean removeSupportPlane) { this.removeSupportPlane = removeSupportPlane; }

    void start() { close(); }
    DepthCloud cloud() { return cloud; }
    Pose originPose() { return origin == null ? null : origin.getPose(); }

    void sample(Session session, Frame frame, double halfExtent) {
        if (frame.getCamera().getTrackingState() != TrackingState.TRACKING
            || (origin != null && origin.getTrackingState() != TrackingState.TRACKING)) return;
        long now = System.nanoTime();
        if (now - lastSampleTime < 200_000_000L) return;
        lastSampleTime=now;
        try (Image depth = frame.acquireRawDepthImage16Bits(); Image confidence = frame.acquireRawDepthConfidenceImage()) {
            if (depth.getTimestamp() <= lastDepthTimestamp || depth.getTimestamp() != confidence.getTimestamp()) return;
            lastDepthTimestamp = depth.getTimestamp();
            if (depth.getWidth() != confidence.getWidth() || depth.getHeight() != confidence.getHeight()) throw new IllegalStateException("Depth and confidence images do not match.");
            CameraIntrinsics intrinsics = frame.getCamera().getTextureIntrinsics();
            float[] focal = intrinsics.getFocalLength(), centre = intrinsics.getPrincipalPoint();
            int[] size = intrinsics.getImageDimensions();
            float fx = focal[0] * depth.getWidth() / size[0], fy = focal[1] * depth.getHeight() / size[1];
            float cx = centre[0] * depth.getWidth() / size[0], cy = centre[1] * depth.getHeight() / size[1];
            Image.Plane pixels = depth.getPlanes()[0], certainty = confidence.getPlanes()[0];
            DepthPixels image=new DepthPixels(pixels.getBuffer(),certainty.getBuffer(),depth.getWidth(),depth.getHeight(),pixels.getRowStride(),pixels.getPixelStride(),certainty.getRowStride(),certainty.getPixelStride());
            int[] diagnostics=image.centralSample();
            guidance.depth(depth.getTimestamp(),diagnostics[0],diagnostics[1]);
            Pose camera = frame.getCamera().getPose();
            DepthProjection.Projector projector = new DepthProjection.Projector(fx,fy,cx,cy);
            if (origin == null) {
                int bestX = -1, bestY = -1, bestDistance = Integer.MAX_VALUE, bestDepth = 0;
                int middleX = depth.getWidth() / 2, middleY = depth.getHeight() / 2;
                for (int y = Math.max(0,middleY - 10); y < Math.min(depth.getHeight(),middleY + 11); y++) {
                    for (int x = Math.max(0,middleX - 10); x < Math.min(depth.getWidth(),middleX + 11); x++) {
                        int mm = image.millimetres(x,y);
                        int level = image.confidence(x,y);
                        int distance = (x - middleX) * (x - middleX) + (y - middleY) * (y - middleY);
                        if (mm >= 150 && mm <= 3000 && level >= 204 && distance < bestDistance) { bestX = x; bestY = y; bestDepth = mm; bestDistance = distance; }
                    }
                }
                if (bestX < 0) return;
                projector.writePoint(bestX,bestY,bestDepth,cameraPoint,0);
                // Move the selection centre slightly behind the visible front surface.
                origin = session.createAnchor(camera.compose(Pose.makeTranslation(cameraPoint[0],cameraPoint[1],cameraPoint[2] - 0.08f)));
                cloud = new DepthCloud(halfExtent,guidance);
            }
            Pose inverse = origin.getPose().inverse();
            List<SupportPlane> planes = new ArrayList<>();
            if (removeSupportPlane) for (Plane plane : session.getAllTrackables(Plane.class)) {
                if (plane.getTrackingState() == TrackingState.TRACKING && plane.getSubsumedBy() == null
                    && plane.getType() == Plane.Type.HORIZONTAL_UPWARD_FACING) planes.add(new SupportPlane(plane));
            }
            int sampleCapacity = ((depth.getWidth() + 2) / 3) * ((depth.getHeight() + 2) / 3) * 4;
            if (sampleBuffer.length != sampleCapacity) sampleBuffer = new float[sampleCapacity];
            int count = 0;
            for (int y = 0; y < depth.getHeight(); y += 3) for (int x = 0; x < depth.getWidth(); x += 3) {
                int level = image.confidence(x,y);
                if (level < 204) continue;
                int mm = image.millimetres(x,y);
                if (mm < 150 || mm > 4000) continue;
                projector.writePoint(x,y,mm,cameraPoint,0);
                camera.transformPoint(cameraPoint,0,worldPoint,0);
                boolean support = false;
                for (SupportPlane supportPlane : planes) {
                    supportPlane.worldToLocal.transformPoint(worldPoint,0,relativePoint,0);
                    if (Math.abs(relativePoint[1]) < 0.015f && supportPlane.plane.isPoseInPolygon(Pose.makeTranslation(worldPoint))) { support = true; break; }
                }
                if (support) continue;
                inverse.transformPoint(worldPoint,0,localPoint,0);
                sampleBuffer[count++] = localPoint[0]; sampleBuffer[count++] = localPoint[1]; sampleBuffer[count++] = localPoint[2]; sampleBuffer[count++] = level / 255f;
            }
            camera.getTranslation(cameraLocal,0);
            inverse.transformPoint(cameraLocal,0,cameraLocal,0);
            cloud.addFrame(depth.getTimestamp(),sampleBuffer,count,cameraLocal);
        } catch (NotYetAvailableException expected) {
            // Sparse or temporarily unavailable depth: keep the previous cloud, never fabricate points.
        }
    }

    void close() {
        if (origin != null) origin.detach();
        origin = null; cloud = null; lastDepthTimestamp = -1; lastSampleTime = 0; guidance=new CaptureGuidance();
    }
}
