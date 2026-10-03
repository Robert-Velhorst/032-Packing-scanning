package com.packingscanning.app.scanning;

import org.junit.Test;
import static org.junit.Assert.*;

public class DepthCloudTest {
    private static float[] cube(boolean flat) {
        float[] points = new float[16 * 16 * 4];
        int n = 0;
        for (int x = 0; x < 16; x++) for (int y = 0; y < 16; y++) {
            points[n++] = -0.15f + x * 0.02f;
            points[n++] = -0.075f + y * 0.01f;
            points[n++] = flat ? 0 : (x % 2 == 0 ? -0.05f : 0.05f);
            points[n++] = 0.9f;
        }
        return points;
    }

    private static void views(DepthCloud cloud, boolean flat) {
        float[] points = cube(flat);
        for (int frame = 0; frame < 6; frame++) {
            float[] shift = points.clone();
            for (int index = 0; index < shift.length; index += 4) shift[index] += (frame % 2) * 0.006f;
            cloud.addFrame(frame + 1, shift, new float[] {(float) Math.sin(frame * Math.PI / 4), 0, (float) Math.cos(frame * Math.PI / 4)});
        }
    }

    @Test public void metricProjectionHasCorrectSigns() {
        assertArrayEquals(new float[] {0.1f, -0.2f, -1}, DepthProjection.point(60,70,1000,100,100,50,50), 0.00001f);
        assertThrows(IllegalArgumentException.class, () -> DepthProjection.point(0,0,0,100,100,50,50));
    }

    @Test public void filtersBackgroundConfidenceAndNonFinitePoints() {
        DepthCloud cloud = new DepthCloud(0.5);
        cloud.addFrame(1,new float[] {0,0,0,0.9f, 0.1f,0,0,0.1f, 2,0,0,1, Float.NaN,0,0,1},new float[] {0,0,1});
        assertEquals(1,cloud.pointCount());
        assertThrows(IllegalStateException.class,cloud::snapshot);
    }

    @Test public void duplicateOrOldDepthCannotIncreaseCoverage() {
        DepthCloud cloud = new DepthCloud(0.5);
        cloud.addFrame(10,cube(false),new float[] {0,0,1});
        cloud.addFrame(10,cube(false),new float[] {1,0,0});
        cloud.addFrame(9,cube(false),new float[] {-1,0,0});
        assertEquals(1,cloud.viewCount());
        assertThrows(IllegalStateException.class,cloud::snapshot);
    }

    @Test public void boundsComeFromCapturedGeometryAndSnapshotIsDetached() {
        DepthCloud cloud = new DepthCloud(0.5);
        views(cloud,false);
        DepthCloud.Snapshot snapshot = cloud.snapshot();
        assertArrayEquals(new double[] {311,155,105},snapshot.dimensionsMm,0.001);
        snapshot.points.get(0)[0] = 99;
        assertArrayEquals(new double[] {311,155,105},cloud.snapshot().dimensionsMm,0.001);
    }

    @Test public void rejectsCoplanarOrClippedCapture() {
        DepthCloud flat = new DepthCloud(0.5);
        views(flat,true);
        assertThrows(IllegalStateException.class,flat::snapshot);
        DepthCloud clipped = new DepthCloud(0.155);
        views(clipped,false);
        assertThrows(IllegalStateException.class,clipped::snapshot);
    }
}
