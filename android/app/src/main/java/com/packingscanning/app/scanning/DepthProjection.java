package com.packingscanning.app.scanning;

/** Pinhole unprojection, using intrinsics scaled to the raw-depth image resolution. */
public final class DepthProjection {
    private DepthProjection() {}

    public static float[] point(int x, int y, int depthMm, float fx, float fy, float cx, float cy) {
        if (depthMm <= 0 || depthMm > 4000 || !Float.isFinite(fx) || !Float.isFinite(fy)
            || !Float.isFinite(cx) || !Float.isFinite(cy) || fx <= 0 || fy <= 0) {
            throw new IllegalArgumentException("Invalid depth or camera intrinsics.");
        }
        float metres = depthMm / 1000f;
        // ARCore camera coordinates: +X right, +Y up, camera looking along -Z.
        return new float[] {(x - cx) * metres / fx, -(y - cy) * metres / fy, -metres};
    }
}
