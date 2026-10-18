package com.packingscanning.app.scanning;

/** Pinhole unprojection, using intrinsics scaled to the raw-depth image resolution. */
public final class DepthProjection {
    private DepthProjection() {}

    /** Validated camera model for projecting many depth pixels without per-point allocations. */
    public static final class Projector {
        private final float inverseFx;
        private final float inverseFy;
        private final float cx;
        private final float cy;

        public Projector(float fx, float fy, float cx, float cy) {
            if (!Float.isFinite(fx) || !Float.isFinite(fy) || !Float.isFinite(cx) || !Float.isFinite(cy)
                || fx <= 0 || fy <= 0) {
                throw new IllegalArgumentException("Invalid camera intrinsics.");
            }
            this.inverseFx = 1f / fx;
            this.inverseFy = 1f / fy;
            this.cx = cx;
            this.cy = cy;
        }

        /** Writes the camera-space point to {@code destination} beginning at {@code offset}. */
        public void writePoint(int x, int y, int depthMm, float[] destination, int offset) {
            if (depthMm <= 0 || depthMm > 4000) {
                throw new IllegalArgumentException("Invalid depth.");
            }
            if (destination == null || offset < 0 || offset > destination.length - 3) {
                throw new IllegalArgumentException("Invalid destination array.");
            }
            float metres = depthMm / 1000f;
            // ARCore camera coordinates: +X right, +Y up, camera looking along -Z.
            destination[offset] = (x - cx) * metres * inverseFx;
            destination[offset + 1] = -(y - cy) * metres * inverseFy;
            destination[offset + 2] = -metres;
        }
    }

    public static float[] point(int x, int y, int depthMm, float fx, float fy, float cx, float cy) {
        Projector projector = new Projector(fx, fy, cx, cy);
        float[] point = new float[3];
        projector.writePoint(x, y, depthMm, point, 0);
        return point;
    }
}
