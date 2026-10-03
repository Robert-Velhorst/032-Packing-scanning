package com.packingscanning.app.scanning;

import org.junit.Test;
import static org.junit.Assert.*;

public class CaptureGuidanceTest {
    @Test public void freshFramesOnlyAndBoundsRemainConsistent() {
        CaptureGuidance g=new CaptureGuidance();g.depth(10,100,30);g.depth(10,100,100);g.depth(9,100,100);
        CaptureGuidance.Summary s=g.summary();assertEquals(1,s.freshFrames);assertEquals(100,s.examinedPixels);assertEquals(30,s.confidentPixels);
        assertThrows(IllegalArgumentException.class,()->g.depth(11,0,0));assertThrows(IllegalArgumentException.class,()->g.depth(11,20,21));
        g.depth(11,20,10);assertEquals(2,g.summary().freshFrames);
    }
    @Test public void allFourSidesStillDoNotClaimSurfaceCompleteness() {
        CaptureGuidance g=new CaptureGuidance();
        for(float[] d:new float[][]{{0,0,1},{1,0,0},{0,0,-1},{-1,0,0}})g.direction(d);
        assertEquals(15,g.summary().sideMask);assertTrue(g.hint(true).contains("higher viewpoint"));
        g.direction(new float[]{0,1,1});g.direction(new float[]{0,-1,1});
        assertEquals(1,g.summary().elevatedViews);assertEquals(1,g.summary().loweredViews);
        assertTrue(g.hint(true).contains("not complete-coverage proof"));assertTrue(g.summary().warnings(true).isEmpty());
    }
    @Test public void sparseRecentDepthRecoversWithoutErasingHistory() {
        CaptureGuidance g=new CaptureGuidance();for(int n=1;n<=8;n++)g.depth(n,100,0);
        assertTrue(g.hint(true).contains("Little high-confidence depth"));
        for(int n=9;n<=16;n++)g.depth(n,100,80);
        assertFalse(g.hint(true).contains("Little high-confidence depth"));assertEquals(1600,g.summary().examinedPixels);assertEquals(640,g.summary().confidentPixels);
    }
    @Test public void missingSideAndBagAdviceAreDifferent() {
        CaptureGuidance g=new CaptureGuidance();g.direction(new float[]{0,0,1});
        assertTrue(g.hint(true).contains("opposite side"));assertTrue(g.hint(false).contains("empty bag"));
        assertTrue(g.summary().warnings(false).isEmpty());assertEquals(2,g.summary().warnings(true).size());
        CaptureGuidance.Summary snapshot=g.summary();g.direction(new float[]{1,0,0});assertEquals(1,snapshot.sideMask);
    }
    @Test public void invalidDirectionsAndNearVerticalViewsDoNotInventSideCoverage() {
        CaptureGuidance g=new CaptureGuidance();g.direction(new float[]{Float.NaN,0,1});g.direction(new float[]{0,0,0});g.direction(new float[]{0,1,0});
        assertEquals(0,g.summary().sideMask);assertEquals(1,g.summary().elevatedViews);
    }
    @Test public void cloudCountsOnlySeparatedContributingViews() {
        CaptureGuidance g=new CaptureGuidance();DepthCloud cloud=new DepthCloud(.5,g);
        float[] points=new float[40*4];for(int n=0;n<40;n++){points[n*4]=n*.005f;points[n*4+3]=.9f;}
        cloud.addFrame(1,points,new float[]{0,0,1});cloud.addFrame(2,points,new float[]{0,.01f,1});
        cloud.addFrame(2,points,new float[]{0,1,0});cloud.addFrame(3,new float[]{0,0,0,.9f},new float[]{0,1,0});
        assertEquals(1,cloud.viewCount());assertEquals(0,g.summary().elevatedViews);
        cloud.addFrame(4,points,new float[]{1,1,0});assertEquals(2,cloud.viewCount());assertEquals(1,g.summary().elevatedViews);
    }
}
