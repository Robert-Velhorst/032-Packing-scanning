package com.packingscanning.app.scanning;

import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Pure geometry in metres in one capture-local frame. No camera or storage dependencies. */
public final class DepthCloud {
    public static final double VOXEL_METRES = 0.005;
    public static final int MAX_POINTS = 60000;
    static final int PREVIEW_POINT_LIMIT = 8000;
    private final double halfExtent;
    private int pointCount;
    private int edgePointCount;
    private long pointRevision;
    private long[] voxelKeys = new long[256];
    private float[] voxelPoints = new float[256 * 4];
    /** Each slot stores a point index plus one; zero means empty. */
    private int[] voxelSlots = new int[512];
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
        addFrame(timestamp,samples,samples == null ? 0 : samples.length,cameraPosition);
    }

    /** Accepts only the populated prefix, allowing callers to reuse a larger sample buffer. */
    synchronized void addFrame(long timestamp, float[] samples, int sampleLength, float[] cameraPosition) {
        if (timestamp <= lastTimestamp || samples == null || sampleLength < 0
            || sampleLength > samples.length || sampleLength % 4 != 0) return;
        lastTimestamp = timestamp;
        int accepted = 0;
        boolean pointsChanged = false;
        for (int index = 0; index < sampleLength; index += 4) {
            float x = samples[index], y = samples[index + 1], z = samples[index + 2], confidence = samples[index + 3];
            if (!Float.isFinite(x) || !Float.isFinite(y) || !Float.isFinite(z)
                || !Float.isFinite(confidence) || confidence < 0.8f || confidence > 1
                || Math.abs(x) > halfExtent || Math.abs(y) > halfExtent || Math.abs(z) > halfExtent) continue;
            long key = voxelKey(cell(x),cell(y),cell(z));
            int slot = findSlot(key);
            int pointIndex = voxelSlots[slot] - 1;
            if (pointIndex < 0) {
                if (pointCount >= MAX_POINTS) { capped = true; continue; }
                ensurePointCapacity(pointCount + 1);
                if ((pointCount + 1) * 10 >= voxelSlots.length * 7) {
                    growSlots();
                    slot = findSlot(key);
                }
                pointIndex = pointCount++;
                voxelKeys[pointIndex] = key;
                voxelSlots[slot] = pointIndex + 1;
                int pointOffset = pointIndex * 4;
                voxelPoints[pointOffset] = x;
                voxelPoints[pointOffset + 1] = y;
                voxelPoints[pointOffset + 2] = z;
                voxelPoints[pointOffset + 3] = confidence;
                if (nearEdge(x,y,z)) edgePointCount++;
                pointsChanged = true;
            } else {
                int pointOffset = pointIndex * 4;
                if (confidence > voxelPoints[pointOffset + 3]) {
                    boolean wasNearEdge = nearEdge(voxelPoints[pointOffset],voxelPoints[pointOffset + 1],voxelPoints[pointOffset + 2]);
                    boolean isNearEdge = nearEdge(x,y,z);
                    voxelPoints[pointOffset] = x;
                    voxelPoints[pointOffset + 1] = y;
                    voxelPoints[pointOffset + 2] = z;
                    voxelPoints[pointOffset + 3] = confidence;
                    if (wasNearEdge != isNearEdge) edgePointCount += isNearEdge ? 1 : -1;
                    pointsChanged = true;
                }
            }
            accepted++;
        }
        if (accepted >= 30) {
            frames++;
            recordDirection(cameraPosition);
        }
        if (pointsChanged) pointRevision++;
    }

    private static long cell(float value) { return (long) Math.floor(value / VOXEL_METRES); }

    private boolean nearEdge(float x, float y, float z) {
        return Math.abs(x) > halfExtent - 0.015 || Math.abs(y) > halfExtent - 0.015
            || Math.abs(z) > halfExtent - 0.015;
    }

    /** Capture bounds keep cell coordinates within the signed 21-bit range. */
    private static long voxelKey(long x, long y, long z) {
        return ((x & 0x1fffffL) << 42) | ((y & 0x1fffffL) << 21) | (z & 0x1fffffL);
    }

    private int findSlot(long key) {
        int mask = voxelSlots.length - 1;
        int slot = (int) mix(key) & mask;
        while (voxelSlots[slot] != 0 && voxelKeys[voxelSlots[slot] - 1] != key) slot = (slot + 1) & mask;
        return slot;
    }

    private static long mix(long value) {
        value ^= value >>> 33;
        value *= 0xff51afd7ed558ccdL;
        value ^= value >>> 33;
        value *= 0xc4ceb9fe1a85ec53L;
        return value ^ (value >>> 33);
    }

    private void ensurePointCapacity(int required) {
        if (required <= voxelKeys.length) return;
        int capacity = Math.min(MAX_POINTS, voxelKeys.length * 2);
        if (capacity < required) capacity = required;
        long[] keys = new long[capacity];
        float[] points = new float[capacity * 4];
        System.arraycopy(voxelKeys,0,keys,0,pointCount);
        System.arraycopy(voxelPoints,0,points,0,pointCount * 4);
        voxelKeys = keys;
        voxelPoints = points;
    }

    private void growSlots() {
        voxelSlots = new int[voxelSlots.length * 2];
        for (int index = 0; index < pointCount; index++) {
            int slot = findSlot(voxelKeys[index]);
            voxelSlots[slot] = index + 1;
        }
    }

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

    public synchronized int pointCount() { return pointCount; }
    public synchronized int viewCount() { return directions.size(); }

    synchronized void clear() {
        Arrays.fill(voxelKeys,0L);
        Arrays.fill(voxelPoints,0f);
        Arrays.fill(voxelSlots,0);
        pointCount=0; edgePointCount=0; pointRevision++; lastTimestamp=-1; frames=0; capped=false;
        directions.clear();
    }

    synchronized long pointRevision() { return pointRevision; }

    /** Cheap gate for the review button; the full scan envelope is fitted only on user request. */
    synchronized String captureReadinessIssue() {
        if (pointCount < 300 || frames < 6 || directions.size() < 3) {
            return "More coverage is needed. Move slowly around the object from at least three angles.";
        }
        double spread = directionSpread();
        if (spread < Math.toRadians(60)) return "Move farther around the object before finishing.";
        if (edgePointCount > pointCount * 0.02) return "The scan reaches the capture-area edge. Restart with a larger area or remove surrounding objects.";
        return null;
    }

    private double directionSpread() {
        double spread = 0;
        for (float[] a : directions) for (float[] b : directions) {
            spread = Math.max(spread, Math.acos(Math.max(-1, Math.min(1, dot(a, b)))));
        }
        return spread;
    }

    /** Copies the preview directly into a reusable render buffer and returns its point count. */
    synchronized int writePreviewPoints(FloatBuffer destination) {
        int count = Math.min(pointCount,PREVIEW_POINT_LIMIT);
        if (destination == null || destination.remaining() < count * 3) {
            throw new IllegalArgumentException("Preview buffer is too small.");
        }
        for (int index = 0; index < count; index++) {
            int source = index * 4;
            destination.put(voxelPoints[source]);
            destination.put(voxelPoints[source + 1]);
            destination.put(voxelPoints[source + 2]);
        }
        return count;
    }

    public synchronized float[] previewPoints() {
        int count = Math.min(pointCount,PREVIEW_POINT_LIMIT);
        float[] result = new float[count * 3];
        for (int index = 0; index < count; index++) {
            int source = index * 4, target = index * 3;
            result[target] = voxelPoints[source];
            result[target + 1] = voxelPoints[source + 1];
            result[target + 2] = voxelPoints[source + 2];
        }
        return result;
    }

    public synchronized Snapshot snapshot() {
        String readinessIssue = captureReadinessIssue();
        if (readinessIssue != null) throw new IllegalStateException(readinessIssue);
        List<float[]> points = new ArrayList<>(pointCount);
        for (int index = 0; index < pointCount; index++) {
            int offset = index * 4;
            float[] sample = new float[] {voxelPoints[offset],voxelPoints[offset + 1],voxelPoints[offset + 2],voxelPoints[offset + 3]};
            points.add(sample);
        }
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
