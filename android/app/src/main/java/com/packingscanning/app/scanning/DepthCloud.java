package com.packingscanning.app.scanning;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Pure geometry in metres in one capture-local frame. No camera or storage dependencies. */
public final class DepthCloud {
    public static final double VOXEL_METRES = 0.005;
    public static final int MAX_POINTS = 60000;
    private final double halfExtent;
    private final Map<String, float[]> voxels = new LinkedHashMap<>();
    private final List<float[]> directions = new ArrayList<>();
    private long lastTimestamp = -1;
    private int frames;
    private boolean capped;
    private final CaptureGuidance guidance;

    public DepthCloud(double halfExtent) { this(halfExtent,new CaptureGuidance()); }

    DepthCloud(double halfExtent,CaptureGuidance guidance) {
        if (!Double.isFinite(halfExtent) || halfExtent < 0.05 || halfExtent > 1.5) {
            throw new IllegalArgumentException("Choose a capture area from 10 cm to 3 m wide.");
        }
        this.halfExtent = halfExtent;
        if(guidance==null)throw new IllegalArgumentException("Missing capture guidance.");
        this.guidance=guidance;
    }

    /** Samples are x,y,z,confidence tuples, already transformed into the capture frame. */
    public synchronized void addFrame(long timestamp, float[] samples, float[] cameraPosition) {
        if (timestamp <= lastTimestamp || samples == null || samples.length % 4 != 0) return;
        lastTimestamp = timestamp;
        int accepted = 0;
        for (int index = 0; index < samples.length; index += 4) {
            float x = samples[index], y = samples[index + 1], z = samples[index + 2], confidence = samples[index + 3];
            if (!Float.isFinite(x) || !Float.isFinite(y) || !Float.isFinite(z)
                || !Float.isFinite(confidence) || confidence < 0.8f || confidence > 1
                || Math.abs(x) > halfExtent || Math.abs(y) > halfExtent || Math.abs(z) > halfExtent) continue;
            String key = cell(x) + ":" + cell(y) + ":" + cell(z);
            float[] previous = voxels.get(key);
            if (previous == null && voxels.size() >= MAX_POINTS) { capped = true; continue; }
            if (previous == null || confidence > previous[3]) voxels.put(key, new float[] {x, y, z, confidence});
            accepted++;
        }
        if (accepted >= 30) {
            frames++;
            recordDirection(cameraPosition);
        }
    }

    private static long cell(float value) { return (long) Math.floor(value / VOXEL_METRES); }

    private void recordDirection(float[] position) {
        if (position == null || position.length != 3) return;
        double norm = Math.sqrt(position[0] * position[0] + position[1] * position[1] + position[2] * position[2]);
        if (!Double.isFinite(norm) || norm < 0.05) return;
        float[] direction = new float[] {(float) (position[0] / norm), (float) (position[1] / norm), (float) (position[2] / norm)};
        for (float[] old : directions) {
            if (dot(old, direction) > Math.cos(Math.toRadians(25))) return;
        }
        directions.add(direction);
        guidance.direction(direction);
    }

    private static double dot(float[] a, float[] b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

    public synchronized int pointCount() { return voxels.size(); }
    public synchronized int viewCount() { return directions.size(); }

    public synchronized float[] previewPoints() {
        int count = Math.min(voxels.size(),8000);
        float[] result = new float[count * 3];
        int index = 0;
        for (float[] point : voxels.values()) {
            if (index == result.length) break;
            result[index++] = point[0]; result[index++] = point[1]; result[index++] = point[2];
        }
        return result;
    }

    public synchronized Snapshot snapshot() {
        if (voxels.size() < 300 || frames < 6 || directions.size() < 3) {
            throw new IllegalStateException("More coverage is needed. Move slowly around the object from at least three angles.");
        }
        double spread = 0;
        for (float[] a : directions) for (float[] b : directions) {
            spread = Math.max(spread, Math.acos(Math.max(-1, Math.min(1, dot(a, b)))));
        }
        if (spread < Math.toRadians(60)) throw new IllegalStateException("Move farther around the object before finishing.");
        List<float[]> points = new ArrayList<>();
        int edgePoints = 0;
        for (float[] sample : voxels.values()) {
            points.add(sample.clone());
            boolean nearEdge = false;
            for (int axis = 0; axis < 3; axis++) {
                nearEdge |= Math.abs(sample[axis]) > halfExtent - 0.015;
            }
            if (nearEdge) edgePoints++;
        }
        if (edgePoints > points.size() * 0.02) throw new IllegalStateException("The scan reaches the capture-area edge. Restart with a larger area or remove surrounding objects.");
        ScanEnvelope envelope=ScanEnvelope.fit(points,VOXEL_METRES/2);
        return new Snapshot(points, envelope, frames, directions.size(), capped, guidance.summary());
    }

    public static final class Snapshot {
        public final List<float[]> points;
        public final double[] dimensionsMm;
        public final ScanEnvelope envelope;
        public final int frames, views;
        public final boolean capped;
        public final CaptureGuidance.Summary guidance;

        private Snapshot(List<float[]> points, ScanEnvelope envelope, int frames, int views, boolean capped,CaptureGuidance.Summary guidance) {
            this.points = points;
            this.envelope=envelope;
            this.dimensionsMm = envelope.dimensionsMm.clone();
            this.frames = frames;
            this.views = views;
            this.capped = capped;
            this.guidance=guidance;
        }
    }
}
